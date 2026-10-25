import Foundation

class AntiCheatBypass {
    
    // Spoofed Device Fingerprint
    static let spoofedUserAgent = "FIFA/23.1.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148"
    static let spoofedDeviceID = UUID().uuidString
    static let spoofedBuildVersion = "23.1.0"
    
    /// Generates a fresh set of headers for each request to avoid pattern detection
    static func generateHeaders(token: String) -> [String: String] {
        return [
            "Authorization": "Bearer \(token)",
            "Content-Type": "application/json",
            "User-Agent": spoofedUserAgent,
            "X-Device-ID": spoofedDeviceID,
            "X-Build-Version": spoofedBuildVersion,
            "X-Transaction-ID": UUID().uuidString,
            "Accept-Language": "en-US,en;q=0.9",
            "Accept-Encoding": "gzip, deflate, br"
        ]
    }
    
    /// Simulates a small time delay between requests to mimic human behavior
    static func simulateHumanDelay() async {
        let delay = Double.random(in: 0.2...0.8) // Random delay between 200ms and 800ms
        try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
    }
}