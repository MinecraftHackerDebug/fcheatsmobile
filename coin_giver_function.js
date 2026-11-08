#!/usr/bin/env python3
"""
build_ios_app.py — wraps server.js into a sideloadable iOS app.

Produces dist/FCCoinLab.ipa: a WKWebView shell around an embedded Node runtime
(nodejs-mobile) that boots server.js and loads the panel from 127.0.0.1.

Requires: macOS, Xcode + command line tools, npm, network access once.
Signing is skipped; run the .ipa through Sideloadly / AltStore / Xcode.

    python3 build_ios_app.py
    python3 build_ios_app.py --name "Coin Lab" --node-version 18.20.4
    python3 build_ios_app.py --skip-build      # project only, no xcodebuild
"""

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BUILD = ROOT / "_build"
DIST = ROOT / "dist"
APP = "FC Coin Lab"

NODE_DEFAULT = "18.20.4"


def oid(*parts: str) -> str:
    return hashlib.md5("|".join(parts).encode()).hexdigest()[:24].upper()


def run(cmd, **kw):
    print("  $", " ".join(str(c) for c in cmd))
    subprocess.run(cmd, check=True, **kw)


def sh(cmd):
    return subprocess.run(cmd, shell=True, capture_output=True, text=True)


# ─────────────────────────── prerequisites ───────────────────────────

def preflight():
    if sys.platform != "darwin":
        sys.exit("iOS builds need macOS with Xcode installed.")
    for tool in ("xcrun", "sips", "npm", "curl"):
        if not shutil.which(tool):
            sys.exit(f"Missing required tool: {tool}")
    if sh("xcrun -f xcodebuild").returncode != 0:
        sys.exit("xcodebuild not found. Install Xcode and run: "
                 "sudo xcode-select --switch /Applications/Xcode.app")
    if not (ROOT / "server.js").is_file():
        sys.exit("server.js not found next to this script.")
    if not (ROOT / "icon.png").is_file():
        sys.exit("icon.png not found next to this script.")


# ──────────────────────────── node runtime ───────────────────────────

def fetch_node_framework(version: str) -> Path:
    cache = ROOT / "_cache" / f"nodejs-mobile-{version}.zip"
    cache.parent.mkdir(exist_ok=True)
    if not cache.exists():
        url = ("https://github.com/nodejs-mobile/nodejs-mobile/releases/download/"
               f"v{version}/nodejs-mobile-v{version}-ios.zip")
        print(f"  downloading nodejs-mobile {version} …")
        urllib.request.urlretrieve(url, cache)
    dest = BUILD / "Frameworks"
    dest.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(cache) as z:
        z.extractall(BUILD / "_node_tmp")
    src = BUILD / "_node_tmp" / "NodeMobile.framework"
    if not src.is_dir():
        sys.exit("NodeMobile.framework missing from archive — check --node-version.")
    if (dest / "NodeMobile.framework").exists():
        shutil.rmtree(dest / "NodeMobile.framework")
    shutil.copytree(src, dest / "NodeMobile.framework", symlinks=True)
    shutil.rmtree(BUILD / "_node_tmp", ignore_errors=True)
    return dest / "NodeMobile.framework"


# ─────────────────────────────── icons ───────────────────────────────

SIZES = [(20, 2), (20, 3), (29, 2), (29, 3), (40, 2), (40, 3),
         (60, 2), (60, 3), (76, 2), (83.5, 2), (1024, 1)]


def make_icons(source: Path, app_dir: Path):
    iconset = app_dir / "Assets.xcassets" / "AppIcon.appiconset"
    iconset.mkdir(parents=True, exist_ok=True)
    (app_dir / "Assets.xcassets" / "Contents.json").write_text(
        json.dumps({"info": {"author": "xcode", "version": 1}}))

    images = []
    for base, scale in SIZES:
        px = int(round(base * scale))
        name = f"icon-{px}.png"
        run(["sips", "-z", str(px), str(px), str(source), "--out", str(iconset / name)],
            stdout=subprocess.DEVNULL)
        images.append({"filename": name, "idiom": "universal",
                       "scale": f"{scale}x", "size": f"{base}x{base}"})

    (iconset / "Contents.json").write_text(json.dumps({"images": images, "info": {
        "author": "xcode", "version": 1}}, indent=2))


# ──────────────────────────── swift sources ──────────────────────────

MAIN_SWIFT = """import UIKit

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

    func application(_ app: UIApplication,
                     didFinishLaunchingWithOptions opts: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        NodeRunner.shared.start()
        let win = UIWindow(frame: UIScreen.main.bounds)
        win.rootViewController = ViewController()
        win.makeKeyAndVisible()
        window = win
        return true
    }
}
"""

NODE_RUNNER_SWIFT = """import Foundation

/// Boots the embedded Node runtime with server.js.
final class NodeRunner {
    static let shared = NodeRunner()
    private var engine: NodeMobile?
    private var booted = false

    func start() {
        guard !booted else { return }
        booted = true
        guard let project = Bundle.main.resourceURL?
            .appendingPathComponent("nodejs-project") else { return }
        let entry = project.appendingPathComponent("server.js").path
        engine = NodeMobile()
        engine?.start("server.js", arguments: ["node", entry], startPath: project.path)
    }
}
"""

VIEW_SWIFT = """import UIKit
import WebKit

final class ViewController: UIViewController, WKNavigationDelegate {
    private var web: WKWebView!
    private var tries = 0
    private let port = 8081

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0.043, green: 0.051, blue: 0.063, alpha: 1)

        let cfg = WKWebViewConfiguration()
        cfg.allowsInlineMediaPlayback = true
        web = WKWebView(frame: view.bounds, configuration: cfg)
        web.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        web.navigationDelegate = self
        web.isOpaque = false
        web.backgroundColor = view.backgroundColor
        web.scrollView.contentInsetAdjustmentBehavior = .never
        view.addSubview(web)

        waitForServer()
    }

    /// Node needs a moment to bind the port; poll instead of guessing a delay.
    private func waitForServer() {
        guard tries < 120 else { return }
        tries += 1
        var req = URLRequest(url: URL(string: "http://127.0.0.1:\\(port)/status")!)
        req.timeoutInterval = 0.4
        URLSession.shared.dataTask(with: req) { [weak self] _, resp, _ in
            guard let self else { return }
            if (resp as? HTTPURLResponse)?.statusCode == 200 {
                DispatchQueue.main.async { self.load() }
            } else {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { self.waitForServer() }
            }
        }.resume()
    }

    private func load() {
        guard let url = URL(string: "http://127.0.0.1:\\(port)/") else { return }
        web.load(URLRequest(url: url))
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation _: WKNavigation!,
                 withError _: Error) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { self.waitForServer() }
    }
}
"""

INFO_PLIST = """<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleDisplayName</key><string>{name}</string>
  <key>CFBundleExecutable</key><string>{name}</string>
  <key>CFBundleIdentifier</key><string>{bundle}</string>
  <key>CFBundleName</key><string>{name}</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSRequiresIPhoneOS</key><true/>
  <key>UILaunchScreen</key><dict>
    <key>UIColorName</key><string></string>
  </dict>
  <key>UIViewControllerBasedStatusBarAppearance</key><false/>
  <key>UIStatusBarStyle</key><string>UIStatusBarStyleLightContent</string>
  <key>UISupportedInterfaceOrientations</key>
  <array><string>UIInterfaceOrientationPortrait</string></array>
  <key>NSAppTransportSecurity</key><dict>
    <key>NSAllowsLocalNetworking</key><true/>
    <key>NSAllowsArbitraryLoads</key><true/>
  </dict>
  <key>UIBackgroundModes</key><array><string>fetch</string></array>
</dict></plist>
"""

BRIDGE_HEADER = "#import <NodeMobile/NodeMobile.h>\n"


# ───────────────────────────── pbxproj ───────────────────────────────

def pbxproj(name: str, bundle: str) -> str:
    f = lambda *p: oid("file", *p)
    b = lambda *p: oid("build", *p)
    g = lambda *p: oid("group", *p)

    files = {
        "main": f("main.swift"), "node": f("NodeRunner.swift"),
        "view": f("ViewController.swift"), "bridge": f("Bridging-Header.h"),
        "plist": f("Info.plist"), "assets": f("Assets.xcassets"),
        "proj": f("nodejs-project"), "fw": f("NodeMobile.framework"),
        "app": f("product.app"),
    }
    build = {k: b(k) for k in ("main", "node", "view", "assets", "proj", "fw", "fwembed")}
    grp = {k: g(k) for k in ("main", "app", "fw", "prod")}

    def fileref(i, path, typ, source_tree="<group>"):
        return (f'\t\t{i} /* {path} */ = {{isa = PBXFileReference; '
                f'lastKnownFileType = {typ}; path = {path}; sourceTree = "{source_tree}"; }};\n')

    def buildfile(i, ref, name_):
        return (f'\t\t{i} /* {name_} in Phase */ = {{isa = PBXBuildFile; '
                f'fileRef = {ref} /* {name_} */; }};\n')

    out = ['// !$*UTF8*$!\n{\n\tarchiveVersion = 1;\n\tclasses = {};\n\tobjectVersion = 56;\n\tobjects = {\n\n']

    out.append("/* Begin PBXBuildFile section */\n")
    for k, nm in (("main", "main.swift"), ("node", "NodeRunner.swift"),
                  ("view", "ViewController.swift"), ("assets", "Assets.xcassets"),
                  ("proj", "nodejs-project"), ("fw", "NodeMobile.framework"),
                  ("fwembed", "NodeMobile.framework")):
        out.append(buildfile(build[k], files["node" if k == "node" else k.replace("embed", "")], nm))
    out.append("/* End PBXBuildFile section */\n\n")

    out.append("/* Begin PBXFileReference section */\n")
    out.append(fileref(files["main"], "main.swift", "sourcecode.swift"))
    out.append(fileref(files["node"], "NodeRunner.swift", "sourcecode.swift"))
    out.append(fileref(files["view"], "ViewController.swift", "sourcecode.swift"))
    out.append(fileref(files["bridge"], "Bridging-Header.h", "sourcecode.c.h"))
    out.append(fileref(files["plist"], "Info.plist", "text.plist.xml"))
    out.append(fileref(files["assets"], "Assets.xcassets", "folder.assetcatalog"))
    out.append(fileref(files["proj"], "nodejs-project", "folder"))
    out.append(fileref(files["fw"], "NodeMobile.framework", "wrapper.framework", "BUILT_PRODUCTS_DIR"))
    out.append(f'\t\t{files["app"]} /* {name}.app */ = {{isa = PBXFileReference; explicitFileType = '
               f'wrapper.application; includeInIndex = 0; path = "{name}.app"; sourceTree = BUILT_PRODUCTS_DIR; }};\n')
    out.append("/* End PBXFileReference section */\n\n")

    out.append("/* Begin PBXFrameworksBuildPhase section */\n")
    fw_phase = oid("phase", "frameworks")
    out.append(f'\t\t{fw_phase} = {{isa = PBXFrameworksBuildPhase; buildActionMask = 2147483647; '
               f'files = ({build["fw"]} /* NodeMobile.framework */,); runOnlyForDeploymentPostprocessing = 0; }};\n')
    out.append("/* End PBXFrameworksBuildPhase section */\n\n")

    out.append("/* Begin PBXGroup section */\n")
    out.append(f'\t\t{grp["main"]} = {{isa = PBXGroup; children = ({grp["app"]}, {grp["fw"]}, {grp["prod"]},); '
               f'sourceTree = "<group>"; }};\n')
    out.append(f'\t\t{grp["app"]} = {{isa = PBXGroup; children = ({files["main"]}, {files["node"]}, '
               f'{files["view"]}, {files["bridge"]}, {files["plist"]}, {files["assets"]}, {files["proj"]},); '
               f'path = "{APP}"; sourceTree = "<group>"; }};\n')
    out.append(f'\t\t{grp["fw"]} = {{isa = PBXGroup; children = ({files["fw"]},); name = Frameworks; sourceTree = "<group>"; }};\n')
    out.append(f'\t\t{grp["prod"]} = {{isa = PBXGroup; children = ({files["app"]},); name = Products; sourceTree = "<group>"; }};\n')
    out.append("/* End PBXGroup section */\n\n")

    out.append("/* Begin PBXNativeTarget section */\n")
    tgt = oid("target", name)
    src_phase, res_phase, emb_phase = oid("phase", "src"), oid("phase", "res"), oid("phase", "embed")
    out.append(f'\t\t{tgt} = {{isa = PBXNativeTarget; buildConfigurationList = {oid("cfglist", "t")}; '
               f'buildPhases = ({src_phase}, {fw_phase}, {res_phase}, {emb_phase},); '
               f'buildRules = (); dependencies = (); name = "{name}"; productName = "{name}"; '
               f'productReference = {files["app"]}; productType = "com.apple.product-type.application"; }};\n')
    out.append("/* End PBXNativeTarget section */\n\n")

    proj_id = oid("project", name)
    out.append("/* Begin PBXProject section */\n")
    out.append(f'\t\t{proj_id} = {{isa = PBXProject; attributes = {{BuildIndependentTargetsInParallel = 1; '
               f'LastSwiftUpdateCheck = 1500; LastUpgradeCheck = 1500; }}; buildConfigurationList = {oid("cfglist", "p")}; '
               f'compatibilityVersion = "Xcode 14.0"; developmentRegion = en; hasScannedForEncodings = 0; '
               f'knownRegions = (en, Base,); mainGroup = {grp["main"]}; productRefGroup = {grp["prod"]}; '
               f'projectDirPath = ""; projectRoot = ""; targets = ({tgt},); }};\n')
    out.append("/* End PBXProject section */\n\n")

    out.append("/* Begin PBXResourcesBuildPhase section */\n")
    out.append(f'\t\t{res_phase} = {{isa = PBXResourcesBuildPhase; buildActionMask = 2147483647; '
               f'files = ({build["assets"]}, {build["proj"]},); runOnlyForDeploymentPostprocessing = 0; }};\n')
    out.append("/* End PBXResourcesBuildPhase section */\n\n")

    out.append("/* Begin PBXCopyFilesBuildPhase section */\n")
    out.append(f'\t\t{emb_phase} = {{isa = PBXCopyFilesBuildPhase; buildActionMask = 2147483647; '
               f'dstPath = ""; dstSubfolderSpec = 10; files = ({build["fwembed"]},); name = "Embed Frameworks"; '
               f'runOnlyForDeploymentPostprocessing = 0; }};\n')
    out.append("/* End PBXCopyFilesBuildPhase section */\n\n")

    out.append("/* Begin PBXSourcesBuildPhase section */\n")
    out.append(f'\t\t{src_phase} = {{isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; '
               f'files = ({build["main"]}, {build["node"]}, {build["view"]},); runOnlyForDeploymentPostprocessing = 0; }};\n')
    out.append("/* End PBXSourcesBuildPhase section */\n\n")

    def settings(target_level: bool) -> str:
        base = [
            "ALWAYS_SEARCH_USER_PATHS = NO",
            "CLANG_ENABLE_MODULES = YES",
            "CLANG_ENABLE_OBJC_ARC = YES",
            "ENABLE_BITCODE = NO",
            "GCC_C_LANGUAGE_STANDARD = gnu11",
            'IPHONEOS_DEPLOYMENT_TARGET = "15.0"',
            'SDKROOT = "iphoneos"',
            "SWIFT_VERSION = 5.0",
            "ONLY_ACTIVE_ARCH = NO",
        ]
        if not target_level:
            base += ['DEBUG_INFORMATION_FORMAT = "dwarf-with-dsym"',
                     "ENABLE_NS_ASSERTIONS = NO", "VALIDATE_PRODUCT = YES"]
        else:
            base += [
                'PRODUCT_NAME = "$(TARGET_NAME)"',
                f'PRODUCT_BUNDLE_IDENTIFIER = "{bundle}"',
                f'INFOPLIST_FILE = "{APP}/Info.plist"',
                f'SWIFT_OBJC_BRIDGING_HEADER = "{APP}/Bridging-Header.h"',
                "GENERATE_INFOPLIST_FILE = NO",
                'TARGETED_DEVICE_FAMILY = "1,2"',
                "CODE_SIGN_STYLE = Automatic",
                'FRAMEWORK_SEARCH_PATHS = ("$(inherited)", "$(SRCROOT)/Frameworks")',
                'LD_RUNPATH_SEARCH_PATHS = ("$(inherited)", "@executable_path/Frameworks")',
                "ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon",
                'SWIFT_EMIT_LOC_STRINGS = "YES"',
            ]
        return "\n".join("\t\t\t\t" + s + ";" for s in base)

    out.append("/* Begin XCBuildConfiguration section */\n")
    for label, lvl in (("Debug", False), ("Release", False)):
        cid = oid("cfg", "p", label)
        out.append(f'\t\t{cid} /* {label} */ = {{isa = XCBuildConfiguration; buildSettings = {{\n'
                   f'{settings(False)}\n\t\t\t}}; name = {label}; }};\n')
    for label in ("Debug", "Release"):
        cid = oid("cfg", "t", label)
        out.append(f'\t\t{cid} /* {label} */ = {{isa = XCBuildConfiguration; buildSettings = {{\n'
                   f'{settings(True)}\n\t\t\t}}; name = {label}; }};\n')
    out.append("/* End XCBuildConfiguration section */\n\n")

    out.append("/* Begin XCConfigurationList section */\n")
    for key, target in (("p", proj_id), ("t", tgt)):
        cid = oid("cfglist", key)
        out.append(f'\t\t{cid} = {{isa = XCConfigurationList; buildConfigurations = '
                   f'({oid("cfg", key, "Debug")}, {oid("cfg", key, "Release")},); '
                   f'defaultConfigurationIsVisible = 0; defaultConfigurationName = Release; }};\n')
    out.append("/* End XCConfigurationList section */\n\n")

    out.append(f'\t}};\n\trootObject = {proj_id};\n}}\n')
    return "".join(out)


# ─────────────────────────────── build ───────────────────────────────

def scaffold(name: str, bundle: str):
    app_dir = BUILD / APP
    app_dir.mkdir(parents=True, exist_ok=True)
    (BUILD / "Frameworks").mkdir(exist_ok=True)

    (app_dir / "main.swift").write_text(MAIN_SWIFT)
    (app_dir / "NodeRunner.swift").write_text(NODE_RUNNER_SWIFT)
    (app_dir / "ViewController.swift").write_text(VIEW_SWIFT)
    (app_dir / "Bridging-Header.h").write_text(BRIDGE_HEADER)
    (app_dir / "Info.plist").write_text(INFO_PLIST.format(name=name, bundle=bundle))

    make_icons(ROOT / "icon.png", app_dir)

    node_proj = app_dir / "nodejs-project"
    node_proj.mkdir(exist_ok=True)
    shutil.copy2(ROOT / "server.js", node_proj / "server.js")
    (node_proj / "package.json").write_text(json.dumps({
        "name": "fc-coinlab-server", "version": "1.0.0", "private": True,
        "main": "server.js",
        "dependencies": {"http-mitm-proxy": "^1.1.0"},
    }, indent=2))

    print("  installing server dependencies …")
    run(["npm", "install", "--omit=dev", "--no-audit", "--no-fund", "--silent"],
        cwd=node_proj)

    xcodeproj = BUILD / f"{name}.xcodeproj"
    xcodeproj.mkdir(exist_ok=True)
    (xcodeproj / "project.pbxproj").write_text(pbxproj(name, bundle))
    return xcodeproj


def package_ipa(name: str):
    app_path = BUILD / "out" / "Release-iphoneos" / f"{name}.app"
    if not app_path.is_dir():
        sys.exit(f"Build output not found at {app_path}")

    DIST.mkdir(exist_ok=True)
    payload = BUILD / "Payload"
    shutil.rmtree(payload, ignore_errors=True)
    (payload).mkdir()
    shutil.copytree(app_path, payload / f"{name}.app", symlinks=True)

    ipa = DIST / "FCCoinLab.ipa"
    if ipa.exists():
        ipa.unlink()
    with zipfile.ZipFile(ipa, "w", zipfile.ZIP_DEFLATED) as z:
        for p in payload.rglob("*"):
            z.write(p, p.relative_to(BUILD))
    print(f"\n  IPA → {ipa}  ({ipa.stat().st_size / 1e6:.1f} MB)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", default=APP)
    ap.add_argument("--bundle-id", default="com.local.fccoinlab")
    ap.add_argument("--node-version", default=NODE_DEFAULT)
    ap.add_argument("--skip-build", action="store_true")
    args = ap.parse_args()

    preflight()
    shutil.rmtree(BUILD, ignore_errors=True)
    BUILD.mkdir()

    print("· icon")
    print("· node runtime")
    fetch_node_framework(args.node_version)
    print("· project")
    xcodeproj = scaffold(args.name, args.bundle_id)

    if args.skip_build:
        print(f"\nProject ready: {xcodeproj}")
        return

    print("· xcodebuild")
    run(["xcodebuild", "-project", str(xcodeproj), "-scheme", args.name,
         "-configuration", "Release", "-sdk", "iphoneos",
         "-derivedDataPath", str(BUILD / "out"),
         "CODE_SIGNING_ALLOWED=NO", "CODE_SIGNING_REQUIRED=NO", "build"],
        stdout=subprocess.DEVNULL)

    package_ipa(args.name)
    print("\nNext: Sideloadly / AltStore → install FCCoinLab.ipa → trust the profile.")


if __name__ == "__main__":
    main()
