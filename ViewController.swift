import UIKit
import SwiftUI

class CheatViewController: UIViewController {
    
    private let cheatsEngine = FCheatsEngine()
    private var uiView: CheatUIHostingController<CheatUI>?
    
    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        
        // Setup UI
        let uiView = UIHostingController(rootView: CheatUI(engine: cheatsEngine))
        addChild(uiView)
        view.addSubview(uiView.view)
        uiView.view.translatesAutoresizingMaskIntoConstraints = false
        uiView.view.topAnchor.constraint(equalTo: view.topAnchor).isActive = true
        uiView.view.leadingAnchor.constraint(equalTo: view.leadingAnchor).isActive = true
        uiView.view.trailingAnchor.constraint(equalTo: view.trailingAnchor).isActive = true
        uiView.view.bottomAnchor.constraint(equalTo: view.bottomAnchor).isActive = true
        didMove(toParent: uiView)
        
        // Set Token Here (Replace with your actual Session Token)
        cheatsEngine.token = "YOUR_FIFAMOBILE_SESSION_TOKEN_HERE"
    }
}

// MARK: - SwiftUI Interface
struct CheatUI: View {
    @ObservedObject var engine: FCheatsEngine
    @State private var cooldownText = "3.0"
    
    var body: some View {
        VStack(spacing: 20) {
            Text("FCheats iOS")
                .font(.system(size: 32, weight: .bold))
                .foregroundColor(.yellow)
            
            Toggle(isOn: $engine.safeMode) {
                Text("Safe Mode (Inject History)")
                    .font(.body)
            }
            
            HStack {
                Text("Cooldown (Sec):")
                TextField("3.0", text: $cooldownText)
                    .keyboardType(.decimalPad)
                    .textFieldStyle(RoundedBorderTextFieldStyle())
                    .frame(width: 80)
                    .onChange(of: cooldownText) { newValue in
                        if let val = Double(newValue) {
                            engine.setCooldown(val)
                        }
                    }
            }
            
            Button(action: {
                if engine.timer != nil {
                    engine.stopCheating()
                } else {
                    engine.startCheating()
                }
            }) {
                Text(engine.timer != nil ? "STOP" : "START")
                    .font(.headline)
                    .padding()
                    .frame(maxWidth: .infinity)
                    .background(engine.timer != nil ? Color.red : Color.green)
                    .foregroundColor(.white)
                    .cornerRadius(10)
            }
            
            Spacer()
            
            ScrollView {
                ForEach(Array(engine.logs.enumerated()), id: \.offset) { index, log in
                    Text(log)
                        .font(.caption)
                        .foregroundColor(.gray)
                }
            }
            .frame(height: 150)
            .background(Color.black.opacity(0.3))
            .cornerRadius(10)
            
            Text(engine.status)
                .font(.caption)
                .foregroundColor(.blue)
        }
        .padding()
    }
}