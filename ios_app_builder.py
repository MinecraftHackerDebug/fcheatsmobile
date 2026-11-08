#!/usr/bin/env python3
"""
ios_app_builder.py — packages FCheats as a real .app bundle.

Output is dist/FCheats.app: a proper iOS application bundle — Info.plist,
PkgInfo, compiled icon catalog, embedded Node runtime, ad-hoc signature.
dist/FCheats.app.zip is the release artifact.

Requires: macOS, Xcode + command line tools, npm, network access once.

    python3 ios_app_builder.py                 # .app + release zip
    python3 ios_app_builder.py --ipa           # also emit an installable .ipa
    python3 ios_app_builder.py --team ABC123   # sign with a real identity
    python3 ios_app_builder.py --skip-build    # project only
"""

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BUILD = ROOT / "_build"
DIST = ROOT / "dist"
SRC = "FCheats"
DEFAULT_NAME = "FCheats"

SOURCES = ["app.js", "coin_server_editor.js", "gem_giver_function.js", "player_giver_function.js"]
NODE_DEFAULT = "18.20.4"

BG = (0.043, 0.051, 0.063)


def oid(*p: str) -> str:
    return hashlib.md5("|".join(p).encode()).hexdigest()[:24].upper()


def run(cmd, **kw):
    print("  $", " ".join(str(c) for c in cmd))
    subprocess.run(cmd, check=True, **kw)


def sh(cmd):
    return subprocess.run(cmd, shell=True, capture_output=True, text=True)


# ─────────────────────────── prerequisites ───────────────────────────

def preflight():
    if sys.platform != "darwin":
        sys.exit("iOS builds need macOS with Xcode installed.")
    for t in ("xcrun", "sips", "npm", "ditto", "codesign"):
        if not shutil.which(t):
            sys.exit(f"Missing required tool: {t}")
    if sh("xcrun -f xcodebuild").returncode != 0:
        sys.exit("xcodebuild not found. Install Xcode then run: "
                 "sudo xcode-select --switch /Applications/Xcode.app")
    for f in SOURCES + ["icon.png"]:
        if not (ROOT / f).is_file():
            sys.exit(f"Missing {f}")


# ──────────────────────────── node runtime ───────────────────────────

def fetch_node(version: str) -> None:
    cache = ROOT / "_cache" / f"nodejs-mobile-{version}.zip"
    cache.parent.mkdir(exist_ok=True)
    if not cache.exists():
        url = ("https://github.com/nodejs-mobile/nodejs-mobile/releases/download/"
               f"v{version}/nodejs-mobile-v{version}-ios.zip")
        print(f"  downloading nodejs-mobile {version} …")
        urllib.request.urlretrieve(url, cache)

    dest = BUILD / "Frameworks"
    dest.mkdir(parents=True, exist_ok=True)
    tmp = BUILD / "_node"
    with zipfile.ZipFile(cache) as z:
        z.extractall(tmp)
    src = tmp / "NodeMobile.framework"
    if not src.is_dir():
        sys.exit("NodeMobile.framework missing — check --node-version.")
    shutil.copytree(src, dest / "NodeMobile.framework", symlinks=True)
    shutil.rmtree(tmp, ignore_errors=True)


# ─────────────────────────────── assets ──────────────────────────────

ICON_SIZES = [(20, 2), (20, 3), (29, 2), (29, 3), (40, 2), (40, 3),
              (60, 2), (60, 3), (76, 2), (83.5, 2), (1024, 1)]


def make_assets(app_dir: Path) -> None:
    catalog = app_dir / "Assets.xcassets"
    catalog.mkdir(parents=True, exist_ok=True)
    (catalog / "Contents.json").write_text(
        json.dumps({"info": {"author": "xcode", "version": 1}}))

    iconset = catalog / "AppIcon.appiconset"
    iconset.mkdir()
    images = []
    for base, scale in ICON_SIZES:
        px = int(round(base * scale))
        name = f"icon-{px}.png"
        run(["sips", "-z", str(px), str(px), str(ROOT / "icon.png"), "--out", str(iconset / name)],
            stdout=subprocess.DEVNULL)
        images.append({"filename": name, "idiom": "universal",
                       "scale": f"{scale}x", "size": f"{base}x{base}"})
    (iconset / "Contents.json").write_text(json.dumps(
        {"images": images, "info": {"author": "xcode", "version": 1}}, indent=2))

    def colorset(name, rgb):
        d = catalog / f"{name}.colorset"
        d.mkdir()
        (d / "Contents.json").write_text(json.dumps({
            "colors": [{"color": {"color-space": "srgb", "components": {
                "alpha": "1.000", "red": f"{rgb[0]:.3f}",
                "green": f"{rgb[1]:.3f}", "blue": f"{rgb[2]:.3f}"}},
                "idiom": "universal"}],
            "info": {"author": "xcode", "version": 1}}, indent=2))

    colorset("LaunchBackground", BG)
    colorset("AccentColor", (0.784, 0.063, 0.180))


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

/// Boots the embedded Node runtime with app.js.
final class NodeRunner {
    static let shared = NodeRunner()
    private var engine: NodeMobile?
    private var booted = false

    func start() {
        guard !booted else { return }
        booted = true
        guard let project = Bundle.main.resourceURL?
            .appendingPathComponent("nodejs-project") else { return }

        let docs = FileManager.default.urls(for: .documentDirectory,
                                           in: .userDomainMask)[0]
            .appendingPathComponent("fc-data").path

        let entry = project.appendingPathComponent("app.js").path
        engine = NodeMobile()
        engine?.start("app.js",
                      arguments: ["node", entry, "--data-dir=\\(docs)"],
                      startPath: project.path)
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
        guard tries < 160 else { return }
        tries += 1
        var req = URLRequest(url: URL(string: "http://127.0.0.1:\\(port)/status")!)
        req.timeoutInterval = 0.4
        URLSession.shared.dataTask(with: req) { [weak self] _, resp, _ in
            guard let self else { return }
            if (resp as? HTTPURLResponse)?.statusCode == 200 {
                DispatchQueue.main.async {
                    if let url = URL(string: "http://127.0.0.1:\\(self.port)/") {
                        self.web.load(URLRequest(url: url))
                    }
                }
            } else {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { self.waitForServer() }
            }
        }.resume()
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
  <key>CFBundleDevelopmentRegion</key><string>en</string>
  <key>CFBundleDisplayName</key><string>{name}</string>
  <key>CFBundleExecutable</key><string>{name}</string>
  <key>CFBundleIdentifier</key><string>{bundle}</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundleName</key><string>{name}</string>
  <key>CFBundleIconName</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>{version}</string>
  <key>CFBundleVersion</key><string>{build}</string>
  <key>LSRequiresIPhoneOS</key><true/>
  <key>MinimumOSVersion</key><string>15.0</string>
  <key>ITSAppUsesNonExemptEncryption</key><false/>
  <key>UILaunchScreen</key><dict>
    <key>UIColorName</key><string>LaunchBackground</string>
  </dict>
  <key>UIUserInterfaceStyle</key><string>Dark</string>
  <key>UIViewControllerBasedStatusBarAppearance</key><false/>
  <key>UIStatusBarStyle</key><string>UIStatusBarStyleLightContent</string>
  <key>UIRequiresFullScreen</key><true/>
  <key>UISupportedInterfaceOrientations</key>
  <array><string>UIInterfaceOrientationPortrait</string></array>
  <key>UISupportedInterfaceOrientations~ipad</key>
  <array>
    <string>UIInterfaceOrientationPortrait</string>
    <string>UIInterfaceOrientationPortraitUpsideDown</string>
  </array>
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
    f = lambda *p: oid("f", *p)
    b = lambda *p: oid("b", *p)
    g = lambda *p: oid("g", *p)

    files = {"main": f("main.swift"), "node": f("NodeRunner.swift"),
             "view": f("ViewController.swift"), "bridge": f("Bridging-Header.h"),
             "plist": f("Info.plist"), "assets": f("Assets.xcassets"),
             "proj": f("nodejs-project"), "fw": f("NodeMobile.framework"),
             "app": f("product")}
    build = {k: b(k) for k in ("main", "node", "view", "assets", "proj", "fw", "embed")}
    grp = {k: g(k) for k in ("root", "src", "fw", "prod")}

    def ref(i, path, typ, tree="<group>"):
        return (f'\t\t{i} /* {path} */ = {{isa = PBXFileReference; lastKnownFileType = {typ}; '
                f'path = {path}; sourceTree = "{tree}"; }};\n')

    def bf(i, r, nm):
        return (f'\t\t{i} /* {nm} in Phase */ = {{isa = PBXBuildFile; fileRef = {r} /* {nm} */; }};\n')

    o = ['// !$*UTF8*$!\n{\n\tarchiveVersion = 1;\n\tclasses = {};\n\tobjectVersion = 56;\n\tobjects = {\n\n']

    o.append("/* Begin PBXBuildFile section */\n")
    for k, nm in (("main", "main.swift"), ("node", "NodeRunner.swift"),
                  ("view", "ViewController.swift"), ("assets", "Assets.xcassets"),
                  ("proj", "nodejs-project"), ("fw", "NodeMobile.framework"),
                  ("embed", "NodeMobile.framework")):
        o.append(bf(build[k], files[k.replace("embed", "")], nm))
    o.append("/* End PBXBuildFile section */\n\n")

    o.append("/* Begin PBXFileReference section */\n")
    o.append(ref(files["main"], "main.swift", "sourcecode.swift"))
    o.append(ref(files["node"], "NodeRunner.swift", "sourcecode.swift"))
    o.append(ref(files["view"], "ViewController.swift", "sourcecode.swift"))
    o.append(ref(files["bridge"], "Bridging-Header.h", "sourcecode.c.h"))
    o.append(ref(files["plist"], "Info.plist", "text.plist.xml"))
    o.append(ref(files["assets"], "Assets.xcassets", "folder.assetcatalog"))
    o.append(ref(files["proj"], "nodejs-project", "folder"))
    o.append(ref(files["fw"], "NodeMobile.framework", "wrapper.framework", "BUILT_PRODUCTS_DIR"))
    o.append(f'\t\t{files["app"]} /* {name}.app */ = {{isa = PBXFileReference; explicitFileType = '
             f'wrapper.application; includeInIndex = 0; path = "{name}.app"; '
             f'sourceTree = BUILT_PRODUCTS_DIR; }};\n')
    o.append("/* End PBXFileReference section */\n\n")

    fw_phase = oid("ph", "fw")
    o.append("/* Begin PBXFrameworksBuildPhase section */\n")
    o.append(f'\t\t{fw_phase} = {{isa = PBXFrameworksBuildPhase; buildActionMask = 2147483647; '
             f'files = ({build["fw"]} /* NodeMobile.framework */,); runOnlyForDeploymentPostprocessing = 0; }};\n')
    o.append("/* End PBXFrameworksBuildPhase section */\n\n")

    o.append("/* Begin PBXGroup section */\n")
    o.append(f'\t\t{grp["root"]} = {{isa = PBXGroup; children = ({grp["src"]}, {grp["fw"]}, {grp["prod"]},); '
             f'sourceTree = "<group>"; }};\n')
    o.append(f'\t\t{grp["src"]} = {{isa = PBXGroup; children = ({files["main"]}, {files["node"]}, '
             f'{files["view"]}, {files["bridge"]}, {files["plist"]}, {files["assets"]}, {files["proj"]},); '
             f'path = "{SRC}"; sourceTree = "<group>"; }};\n')
    o.append(f'\t\t{grp["fw"]} = {{isa = PBXGroup; children = ({files["fw"]},); name = Frameworks; '
             f'sourceTree = "<group>"; }};\n')
    o.append(f'\t\t{grp["prod"]} = {{isa = PBXGroup; children = ({files["app"]},); name = Products; '
             f'sourceTree = "<group>"; }};\n')
    o.append("/* End PBXGroup section */\n\n")

    tgt = oid("tgt", name)
    src_ph, res_ph, emb_ph = oid("ph", "s"), oid("ph", "r"), oid("ph", "e")
    o.append("/* Begin PBXNativeTarget section */\n")
    o.append(f'\t\t{tgt} = {{isa = PBXNativeTarget; buildConfigurationList = {oid("cl", "t")}; '
             f'buildPhases = ({src_ph}, {fw_phase}, {res_ph}, {emb_ph},); buildRules = (); '
             f'dependencies = (); name = "{name}"; productName = "{name}"; '
             f'productReference = {files["app"]}; productType = "com.apple.product-type.application"; }};\n')
    o.append("/* End PBXNativeTarget section */\n\n")

    proj = oid("proj", name)
    o.append("/* Begin PBXProject section */\n")
    o.append(f'\t\t{proj} = {{isa = PBXProject; attributes = {{BuildIndependentTargetsInParallel = 1; '
             f'LastSwiftUpdateCheck = 1500; LastUpgradeCheck = 1500; }}; buildConfigurationList = {oid("cl", "p")}; '
             f'compatibilityVersion = "Xcode 14.0"; developmentRegion = en; hasScannedForEncodings = 0; '
             f'knownRegions = (en, Base,); mainGroup = {grp["root"]}; productRefGroup = {grp["prod"]}; '
             f'projectDirPath = ""; projectRoot = ""; targets = ({tgt},); }};\n')
    o.append("/* End PBXProject section */\n\n")

    o.append("/* Begin PBXResourcesBuildPhase section */\n")
    o.append(f'\t\t{res_ph} = {{isa = PBXResourcesBuildPhase; buildActionMask = 2147483647; '
             f'files = ({build["assets"]}, {build["proj"]},); runOnlyForDeploymentPostprocessing = 0; }};\n')
    o.append("/* End PBXResourcesBuildPhase section */\n\n")

    o.append("/* Begin PBXCopyFilesBuildPhase section */\n")
    o.append(f'\t\t{emb_ph} = {{isa = PBXCopyFilesBuildPhase; buildActionMask = 2147483647; dstPath = ""; '
             f'dstSubfolderSpec = 10; files = ({build["embed"]},); name = "Embed Frameworks"; '
             f'runOnlyForDeploymentPostprocessing = 0; }};\n')
    o.append("/* End PBXCopyFilesBuildPhase section */\n\n")

    o.append("/* Begin PBXSourcesBuildPhase section */\n")
    o.append(f'\t\t{src_ph} = {{isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; '
             f'files = ({build["main"]}, {build["node"]}, {build["view"]},); runOnlyForDeploymentPostprocessing = 0; }};\n')
    o.append("/* End PBXSourcesBuildPhase section */\n\n")

    def cfg(target_level):
        base = ["ALWAYS_SEARCH_USER_PATHS = NO", "CLANG_ENABLE_MODULES = YES",
                "CLANG_ENABLE_OBJC_ARC = YES", "ENABLE_BITCODE = NO",
                "GCC_C_LANGUAGE_STANDARD = gnu11", 'IPHONEOS_DEPLOYMENT_TARGET = "15.0"',
                'SDKROOT = "iphoneos"', "SWIFT_VERSION = 5.0", "ONLY_ACTIVE_ARCH = NO"]
        if not target_level:
            base += ['DEBUG_INFORMATION_FORMAT = "dwarf-with-dsym"', "ENABLE_NS_ASSERTIONS = NO",
                     "VALIDATE_PRODUCT = YES", "SWIFT_OPTIMIZATION_LEVEL = \"-O\""]
        else:
            base += ['PRODUCT_NAME = "$(TARGET_NAME)"', f'PRODUCT_BUNDLE_IDENTIFIER = "{bundle}"',
                     f'INFOPLIST_FILE = "{SRC}/Info.plist"',
                     f'SWIFT_OBJC_BRIDGING_HEADER = "{SRC}/Bridging-Header.h"',
                     "GENERATE_INFOPLIST_FILE = NO", 'TARGETED_DEVICE_FAMILY = "1,2"',
                     "CODE_SIGN_STYLE = Manual", "DEPLOYMENT_POSTPROCESSING = YES",
                     "STRIP_INSTALLED_PRODUCT = YES", "COPY_PHASE_STRIP = YES",
                     'FRAMEWORK_SEARCH_PATHS = ("$(inherited)", "$(SRCROOT)/Frameworks")',
                     'LD_RUNPATH_SEARCH_PATHS = ("$(inherited)", "@executable_path/Frameworks")',
                     "ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon",
                     "ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME = AccentColor"]
        return "\n".join("\t\t\t\t" + s + ";" for s in base)

    o.append("/* Begin XCBuildConfiguration section */\n")
    for lvl, fn in (("p", cfg), ("t", cfg)):
        for label in ("Debug", "Release"):
            o.append(f'\t\t{oid("cfg", lvl, label)} /* {label} */ = {{isa = XCBuildConfiguration; '
                     f'buildSettings = {{\n{fn(lvl == "t")}\n\t\t\t}}; name = {label}; }};\n')
    o.append("/* End XCBuildConfiguration section */\n\n")

    o.append("/* Begin XCConfigurationList section */\n")
    for key in ("p", "t"):
        o.append(f'\t\t{oid("cl", key)} = {{isa = XCConfigurationList; buildConfigurations = '
                 f'({oid("cfg", key, "Debug")}, {oid("cfg", key, "Release")},); '
                 f'defaultConfigurationIsVisible = 0; defaultConfigurationName = Release; }};\n')
    o.append("/* End XCConfigurationList section */\n\n")

    o.append(f'\t}};\n\trootObject = {proj};\n}}\n')
    return "".join(o)


# ──────────────────────────── bundle assembly ────────────────────────

def scaffold(name, bundle, version, build_no) -> Path:
    app_dir = BUILD / SRC
    app_dir.mkdir(parents=True, exist_ok=True)
    (BUILD / "Frameworks").mkdir(exist_ok=True)

    (app_dir / "main.swift").write_text(MAIN_SWIFT)
    (app_dir / "NodeRunner.swift").write_text(NODE_RUNNER_SWIFT)
    (app_dir / "ViewController.swift").write_text(VIEW_SWIFT)
    (app_dir / "Bridging-Header.h").write_text(BRIDGE_HEADER)
    (app_dir / "Info.plist").write_text(
        INFO_PLIST.format(name=name, bundle=bundle, version=version, build=build_no))

    make_assets(app_dir)

    proj = app_dir / "nodejs-project"
    proj.mkdir(exist_ok=True)
    for f in SOURCES:
        shutil.copy2(ROOT / f, proj / f)
    (proj / "package.json").write_text(json.dumps({
        "name": "fcheats", "version": version, "private": True,
        "main": "app.js", "dependencies": {"http-mitm-proxy": "^1.1.0"},
    }, indent=2))

    print("  installing server dependencies …")
    run(["npm", "install", "--omit=dev", "--no-audit", "--no-fund", "--silent"], cwd=proj)

    xcodeproj = BUILD / f"{name}.xcodeproj"
    xcodeproj.mkdir(exist_ok=True)
    (xcodeproj / "project.pbxproj").write_text(pbxproj(name, bundle))
    return xcodeproj


def sign(app: Path, team: str | None) -> None:
    """Sign nested code first, then the bundle. Ad-hoc unless a team is given."""
    ident = team or "-"
    targets = sorted(
        list(app.rglob("*.framework")) + list(app.rglob("*.dylib")),
        key=lambda p: len(p.parts), reverse=True)
    for t in targets:
        subprocess.run(["codesign", "--force", "--timestamp=none", "--sign", ident, str(t)],
                       check=False, capture_output=True)
    r = subprocess.run(["codesign", "--force", "--timestamp=none", "--sign", ident, str(app)],
                       check=False, capture_output=True, text=True)
    if r.returncode != 0:
        print(f"  warning: signing failed — {r.stderr.strip().splitlines()[:1]}")


def assemble(name: str, team: str | None) -> Path:
    built = BUILD / "out" / "Release-iphoneos" / f"{name}.app"
    if not built.is_dir():
        sys.exit(f"Build output missing: {built}")

    DIST.mkdir(exist_ok=True)
    final = DIST / f"{name}.app"
    if final.exists():
        shutil.rmtree(final)
    shutil.copytree(built, final, symlinks=True)

    (final / "PkgInfo").write_text("APPL????")
    (final / "Embedded.mobileprovision").unlink(missing_ok=True)

    sign(final, team)
    return final


def release_zip(app: Path) -> Path:
    z = app.with_suffix(".app.zip")
    z.unlink(missing_ok=True)
    run(["ditto", "-c", "-k", "--sequesterRsrc", "--keepParent", str(app), str(z)])
    return z


def make_ipa(app: Path) -> Path:
    payload = BUILD / "Payload"
    shutil.rmtree(payload, ignore_errors=True)
    payload.mkdir()
    shutil.copytree(app, payload / app.name, symlinks=True)
    ipa = DIST / "FCheats.ipa"
    ipa.unlink(missing_ok=True)
    with zipfile.ZipFile(ipa, "w", zipfile.ZIP_DEFLATED) as z:
        for p in payload.rglob("*"):
            z.write(p, p.relative_to(BUILD))
    return ipa


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", default=DEFAULT_NAME)
    ap.add_argument("--bundle-id", default="com.fcheats.mobile")
    ap.add_argument("--version", default="1.1.0")
    ap.add_argument("--build", default="1")
    ap.add_argument("--node-version", default=NODE_DEFAULT)
    ap.add_argument("--team")
    ap.add_argument("--ipa", action="store_true")
    ap.add_argument("--no-sign", action="store_true")
    ap.add_argument("--skip-build", action="store_true")
    a = ap.parse_args()

    preflight()
    shutil.rmtree(BUILD, ignore_errors=True)
    BUILD.mkdir()

    print("· assets")
    print("· node runtime")
    fetch_node(a.node_version)
    print("· project")
    xcodeproj = scaffold(a.name, a.bundle_id, a.version, a.build)

    if a.skip_build:
        print(f"\nProject ready: {xcodeproj}")
        return

    print("· compiling")
    run(["xcodebuild", "-project", str(xcodeproj), "-scheme", a.name,
         "-configuration", "Release", "-sdk", "iphoneos", "ARCHS=arm64",
         "-derivedDataPath", str(BUILD / "out"),
         "CODE_SIGNING_ALLOWED=NO", "CODE_SIGNING_REQUIRED=NO", "build"],
        stdout=subprocess.DEVNULL)

    print("· bundling")
    app = assemble(a.name, None if a.no_sign else a.team)

    size = sum(p.stat().st_size for p in app.rglob("*") if p.is_file())
    print(f"\n  {app.name}  ({size / 1e6:.1f} MB)")
    print(f"  {app}")

    z = release_zip(app)
    print(f"  release artifact → {z}  ({z.stat().st_size / 1e6:.1f} MB)")

    if a.ipa:
        print(f"  installer → {make_ipa(app)}")

    digest = hashlib.sha256(z.read_bytes()).hexdigest()
    print(f"  sha256 {digest}")
    print("\nAttach the .app.zip to the release. Install with Sideloadly, AltStore "
          "or TrollStore, then trust the profile.")


if __name__ == "__main__":
    main()
