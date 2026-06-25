import os

with open('App.js', 'r', encoding='utf-8') as f:
    code = f.read()

# 1. Imports
code = code.replace("import { Buffer } from 'buffer';", 
"import { Buffer } from 'buffer';\nimport InCallManager from 'react-native-incall-manager';")

# 2. ActiveCallScreen UI Component
active_call_ui = """
// ─── Active Call Screen ────────────────────────────────────────────────────────
function ActiveCallScreen({ number, onMute, onSpeaker, onEndCall, isMuted, isSpeakerOn }) {
  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
      <BlurView intensity={95} tint="dark" style={[styles.callOverlayRoot, { justifyContent: 'center' }]}>
        <SafeAreaView style={{ flex: 1, alignItems: 'center' }}>
          <Text style={[styles.callNumberLabel, { marginTop: 80 }]}>{number}</Text>
          <Text style={styles.callSubLabel}>Active Call</Text>
          
          <View style={{ flexDirection: 'row', marginTop: 100, gap: 40 }}>
            <TouchableOpacity onPress={onMute} style={{ alignItems: 'center' }}>
              <View style={[styles.callActionBtn, isMuted ? styles.callActionActive : null]}>
                <MaterialCommunityIcons name={isMuted ? "microphone-off" : "microphone"} size={32} color={isMuted ? "black" : "white"} />
              </View>
              <Text style={styles.callButtonLabel}>Mute</Text>
            </TouchableOpacity>
            
            <TouchableOpacity onPress={onSpeaker} style={{ alignItems: 'center' }}>
              <View style={[styles.callActionBtn, isSpeakerOn ? styles.callActionActive : null]}>
                <MaterialCommunityIcons name={isSpeakerOn ? "volume-high" : "volume-medium"} size={32} color={isSpeakerOn ? "black" : "white"} />
              </View>
              <Text style={styles.callButtonLabel}>Speaker</Text>
            </TouchableOpacity>
          </View>

          <View style={{ position: 'absolute', bottom: 60, width: '100%', alignItems: 'center' }}>
            <TouchableOpacity style={styles.callDeclineButton} onPress={onEndCall} activeOpacity={0.75}>
              <MaterialCommunityIcons name="phone-hangup" size={36} color="#ffffff" />
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </BlurView>
    </Modal>
  );
}

// ─── Screen Components ────────────────────────────────────────────────────────"""

code = code.replace("// ─── Screen Components ────────────────────────────────────────────────────────", active_call_ui)

# 3. State
state_str = """  const [callStatus, setCallStatus]   = useState('IDLE'); // 'IDLE' | 'RINGING'
  const [callerNumber, setCallerNumber] = useState('');"""

new_state_str = """  const [callStatus, setCallStatus]   = useState('IDLE'); // 'IDLE' | 'RINGING' | 'ACTIVE'
  const [callerNumber, setCallerNumber] = useState('');
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState(false);
  const isMutedRef = useRef(false);

  useEffect(() => { isMutedRef.current = isMuted; }, [isMuted]);"""

code = code.replace(state_str, new_state_str)

# 4. Ringing
code = code.replace("priority: Notifications.AndroidNotificationPriority.MAX,\n              },\n              trigger: null,\n            });", 
"priority: Notifications.AndroidNotificationPriority.MAX,\n              },\n              trigger: null,\n            });\n            try { InCallManager.startRingtone('_BUNDLE_'); } catch(e) {}")

# 5. Cancel
code = code.replace("AudioBridge.stop();\n            Notifications.dismissAllNotificationsAsync();",
"AudioBridge.stop();\n            Notifications.dismissAllNotificationsAsync();\n            try { InCallManager.stopRingtone(); InCallManager.stop(); } catch(e) {}")


# 6. Decline
code = code.replace("setCallStatus('IDLE');\n    setCallerNumber('');\n    Notifications.dismissAllNotificationsAsync();",
"setCallStatus('IDLE');\n    setCallerNumber('');\n    Notifications.dismissAllNotificationsAsync();\n    try { InCallManager.stopRingtone(); InCallManager.stop(); } catch(e) {}")


# 7. Answer
answer_code = """  function handleAnswer() {
    appendLog({
      type: 'call',
      title: 'Answered on Device',
      subtitle: callerNumber,
      time: nowTime(),
    });
    setCallStatus('IDLE'); // Hide UI once answered to just stream audio
    setCallerNumber('');
    Notifications.dismissAllNotificationsAsync();

    // Tell host we answered
    if (socketRef.current) {
      const payload = JSON.stringify({ type: "CALL_ANSWERED", action: "ACCEPT" });
      socketRef.current.send(payload, 0, payload.length, 8080, hostIPRef.current);
    }
    
    // Start microphone streaming to Host IP
    AudioBridge.start((data) => {
      if (audioSocketRef.current) {
        const buffer = Buffer.from(data, 'base64');
        audioSocketRef.current.send(buffer, 0, buffer.length, 8081, hostIPRef.current, (err) => {});
      }
    });
  }"""

new_answer_code = """  function handleAnswer() {
    appendLog({
      type: 'call',
      title: 'Answered on Device',
      subtitle: callerNumber,
      time: nowTime(),
    });
    setCallStatus('ACTIVE');
    Notifications.dismissAllNotificationsAsync();

    try {
      InCallManager.stopRingtone();
      InCallManager.start({ media: 'audio' });
      InCallManager.setForceSpeakerphoneOn(false);
      setIsSpeakerOn(false);
      setIsMuted(false);
    } catch(e) {}

    // Tell host we answered
    if (socketRef.current) {
      const payload = JSON.stringify({ type: "CALL_ANSWERED", action: "ACCEPT" });
      socketRef.current.send(payload, 0, payload.length, 8080, hostIPRef.current);
    }
    
    // Start microphone streaming to Host IP
    AudioBridge.start((data) => {
      if (audioSocketRef.current && !isMutedRef.current) {
        const buffer = Buffer.from(data, 'base64');
        audioSocketRef.current.send(buffer, 0, buffer.length, 8081, hostIPRef.current, (err) => {});
      }
    });
  }

  function handleEndCall() {
    setCallStatus('IDLE');
    setCallerNumber('');
    AudioBridge.stop();
    try { InCallManager.stop(); } catch(e) {}
    
    if (socketRef.current) {
      const payload = JSON.stringify({ type: "CALL_ANSWERED", action: "DECLINE" });
      socketRef.current.send(payload, 0, payload.length, 8080, hostIPRef.current);
    }
    appendLog({ type: 'call', title: 'Call Ended', subtitle: 'User disconnected', time: nowTime() });
  }

  function toggleMute() {
    setIsMuted(!isMuted);
  }

  function toggleSpeaker() {
    const nextState = !isSpeakerOn;
    setIsSpeakerOn(nextState);
    try { InCallManager.setForceSpeakerphoneOn(nextState); } catch(e) {}
  }"""

code = code.replace(answer_code, new_answer_code)

# 8. Render
render_ui = """      {/* ── Full-screen incoming call overlay ── */}
      {callStatus === 'RINGING' && (
        <IncomingCallOverlay
          number={callerNumber}
          onDecline={handleDecline}
          onAnswer={handleAnswer}
        />
      )}"""

new_render_ui = """      {/* ── Full-screen incoming call overlay ── */}
      {callStatus === 'RINGING' && (
        <IncomingCallOverlay
          number={callerNumber}
          onDecline={handleDecline}
          onAnswer={handleAnswer}
        />
      )}

      {/* ── Active Call Screen ── */}
      {callStatus === 'ACTIVE' && (
        <ActiveCallScreen
          number={callerNumber}
          onMute={toggleMute}
          onSpeaker={toggleSpeaker}
          onEndCall={handleEndCall}
          isMuted={isMuted}
          isSpeakerOn={isSpeakerOn}
        />
      )}"""

code = code.replace(render_ui, new_render_ui)

# 9. Styles
styles = """  callButtonLabel: { color: '#ffffff', fontSize: 15, fontWeight: '400', letterSpacing: 0.1 },"""
new_styles = """  callButtonLabel: { color: '#ffffff', fontSize: 15, fontWeight: '400', letterSpacing: 0.1 },
  callActionBtn: { width: 70, height: 70, borderRadius: 35, backgroundColor: '#333', alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  callActionActive: { backgroundColor: '#fff' },"""

code = code.replace(styles, new_styles)

with open('App.js', 'w', encoding='utf-8') as f:
    f.write(code)

print("App.js updated successfully!")
