import Foundation

protocol NetworkInterceptorDelegate: AnyObject {
    func interceptorDidInjectFakeMatch()
}

class NetworkInterceptor {
    
    weak var delegate: NetworkInterceptorDelegate?
    private let session: URLSession
    
    init(session: URLSession = .shared) {
        self.session = session
    }
    
    /// Injects a fake match result into the server logs to justify currency gains
    func injectFakeMatchHistory(token: String) async {
        guard let url = URL(string: "https://fifamobile.ea.com/fc/api/v1/match/end") else { return }
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        
        // Use the bypass headers
        let headers = AntiCheatBypass.generateHeaders(token: token)
        for (key, value) in headers {
            request.setValue(value, forHTTPHeaderField: key)
        }
        
        // Payload: A convincing but low-stakes match result
        let payload: [String: Any] = [
            "matchId": UUID().uuidString,
            "matchType": "HEAD_TO_HEAD",
            "result": "WIN",
            "scoreHome": 1,
            "scoreAway": 0,
            "coinsEarned": 500, // Small amount to look normal
            "pointsEarned": 10,
            "isOnline": true,
            "timestamp": Date().timeIntervalSince1970
        ]
        
        request.httpBody = try? JSONSerialization.data(withJSONObject: payload)
        
        let (_, response) = try? await session.data(for: request)
        
        if (response as? HTTPURLResponse)?.statusCode == 200 {
            print("✅ Fake Match History Injected")
            delegate?.interceptorDidInjectFakeMatch()
        }
    }
}