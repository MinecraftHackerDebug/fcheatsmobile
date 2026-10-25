import Foundation

class FCheatsEngine: NSObject, ObservableObject {
    
    @Published var status: String = "Idle"
    @Published var logs: [String] = []
    
    private var timer: Timer?
    private var session: URLSession
    private var interceptor: NetworkInterceptor
    private var token: String
    
    // Configuration
    var coinsPerTick: Int = 300_000
    var pointsPerTick: Int = 50
    var gemsPerTick: Int = 1_000
    
    var baseCooldown: Double = 3.0
    var currentCooldown: Double = 3.0
    
    @Published var safeMode: Bool = true {
        didSet {
            interceptor.delegate = safeMode ? self : nil
        }
    }
    
    override init() {
        self.session = URLSession(configuration: .ephemeral)
        self.interceptor = NetworkInterceptor()
        self.token = "" // Set this via ViewController or config
        super.init()
        self.interceptor.delegate = safeMode ? self : nil
    }
    
    func startCheating() {
        stopCheating()
        updateStatus("🚀 Cheating Started")
        
        timer = Timer.scheduledTimer(withTimeInterval: currentCooldown, repeats: true) { [weak self] _ in
            Task { await self?.executeTick() }
        }
    }
    
    func stopCheating() {
        timer?.invalidate()
        timer = nil
        updateStatus("⏹️ Cheating Stopped")
    }
    
    func setCooldown(_ seconds: Double) {
        currentCooldown = max(1.0, seconds)
        // Restart timer with new interval if running
        if timer != nil {
            stopCheating()
            startCheating()
        }
    }
    
    private func executeTick() async {
        updateStatus("⏳ Executing Tick...")
        
        // 1. Optional: Inject Fake History if Safe Mode is ON
        if safeMode {
            await interceptor.injectFakeMatchHistory(token: token)
        }
        
        // 2. Send Requests concurrently but with slight delays to avoid spike detection
        
        // Coin Request
        await sendRequest(type: "COIN", amount: coinsPerTick)
        await AntiCheatBypass.simulateHumanDelay()
        
        // Point Request
        await sendRequest(type: "POINTS", amount: pointsPerTick)
        await AntiCheatBypass.simulateHumanDelay()
        
        // Gem Request
        await sendRequest(type: "GEMS", amount: gemsPerTick)
        
        updateStatus("✅ Tick Complete")
    }
    
    private func sendRequest(type: String, amount: Int) async {
        let endpoint: String
        switch type {
        case "COIN": endpoint = "/fc/api/v1/inventory/addCurrency"
        case "POINTS": endpoint = "/fc/api/v1/inventory/addPoints"
        case "GEMS": endpoint = "/fc/api/v1/inventory/addGems"
        default: endpoint = "/fc/api/v1/inventory/addCurrency"
        }
        
        guard let url = URL(string: "https://fifamobile.ea.com\(endpoint)") else { return }
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        
        let headers = AntiCheatBypass.generateHeaders(token: token)
        for (key, value) in headers {
            request.setValue(value, forHTTPHeaderField: key)
        }
        
        let reason = type == "COIN" ? "MATCH_REWARD" : (type == "GEMS" ? "PURCHASE" : "PROMOTION")
        let payload: [String: Any] = [
            "currencyType": type,
            "amount": amount,
            "reason": reason,
            "transactionId": UUID().uuidString,
            "timestamp": Date().timeIntervalSince1970 * 1000
        ]
        
        request.httpBody = try? JSONSerialization.data(withJSONObject: payload)
        
        do {
            let (_, response) = try await session.data(for: request)
            if let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 {
                updateLog("✅ +\(amount) \(type)")
            } else {
                updateLog("❌ Failed \(type): Status \(httpResponse?.statusCode ?? 0)")
            }
        } catch {
            updateLog("❌ Error \(type): \(error.localizedDescription)")
        }
    }
    
    private func updateStatus(_ message: String) {
        DispatchQueue.main.async {
            self.status = message
        }
    }
    
    private func updateLog(_ message: String) {
        DispatchQueue.main.async {
            self.logs.append("\(Date()) - \(message)")
            // Keep only last 50 logs
            if self.logs.count > 50 {
                self.logs.removeFirst()
            }
        }
    }
}

extension FCheatsEngine: NetworkInterceptorDelegate {
    func interceptorDidInjectFakeMatch() {
        updateLog("🛡️ Safe Mode: Fake Match Injected")
    }
}