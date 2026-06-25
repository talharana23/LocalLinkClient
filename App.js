import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  Modal,
  Platform,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Switch,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Audio } from 'expo-av';

// ── Safe native module imports (these may not be linked in all environments) ──
let dgram = null;
try { dgram = require('react-native-udp'); } catch (e) { console.warn('[UDP] Native module not available:', e.message); }

let RNCallKeep = null;
try { RNCallKeep = require('react-native-callkeep').default; } catch (e) { console.warn('[CallKeep] Native module not available:', e.message); }

let LiveAudioStream = null;
try { LiveAudioStream = require('react-native-live-audio-stream').default; } catch (e) { console.warn('[LiveAudio] Native module not available:', e.message); }

// ── Native Module Configurations ──
const AUDIO_OPTIONS = {
  sampleRate: 44100,
  channels: 1,
  bitsPerSample: 16,
  audioSource: 6,
  bufferSize: 4096
};

class AudioBridge {
  static init() {
    try { if (LiveAudioStream) LiveAudioStream.init(AUDIO_OPTIONS); } catch (e) { console.warn('[AudioBridge] init failed:', e.message); }
  }
  static start(onData) {
    try {
      if (LiveAudioStream) {
        LiveAudioStream.on('data', onData);
        LiveAudioStream.start();
      }
    } catch (e) { console.warn('[AudioBridge] start failed:', e.message); }
  }
  static stop() {
    try { if (LiveAudioStream) LiveAudioStream.stop(); } catch (e) {}
  }
  static write(base64Chunk) {
    try {
      if (LiveAudioStream && typeof LiveAudioStream.write === 'function') {
        LiveAudioStream.write(base64Chunk);
      }
    } catch (e) {}
  }
}

const callKeepOptions = {
  ios: {
    appName: 'Local Link',
    imageName: 'sim_icon',
    supportsVideo: false,
    maximumCallGroups: 1,
    maximumCallsPerCallGroup: 1,
    includesCallsInRecents: false,
  },
  android: { alertTitle: 'Permissions', alertDescription: 'Required', cancelButton: 'Cancel', okButton: 'ok' }
};

let callKeepAvailable = false;
try {
  if (RNCallKeep && typeof RNCallKeep.setup === 'function') {
    RNCallKeep.setup(callKeepOptions);
    RNCallKeep.setAvailable(true);
    callKeepAvailable = true;
  }
} catch (e) {
  console.warn('[CallKeep] Setup failed (expected on free provisioning):', e.message);
}

AudioBridge.init();

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// ─── Palette ─────────────────────────────────────────────────────────────────
const C = {
  black:        '#000000',
  surface:      'rgba(28, 28, 30, 0.80)',
  surfaceSolid: '#1c1c1e',
  border:       'rgba(255, 255, 255, 0.12)',
  green:        '#55ee71',
  greenDim:     'rgba(85, 238, 113, 0.15)',
  greenRing:    'rgba(85, 238, 113, 0.25)',
  red:          '#ff3b30',
  redDim:       'rgba(255, 59, 48, 0.18)',
  white:        '#ffffff',
  gray:         '#8e8e93',
  grayDark:     'rgba(255, 255, 255, 0.06)',
  separator:    'rgba(255, 255, 255, 0.08)',
};

// ─── Static mock data ─────────────────────────────────────────────────────────
const INITIAL_LOG = [
  { id: 1, type: 'sms',  title: 'SMS Sync Complete',    subtitle: 'Local Relay',        time: '11:42 AM' },
  { id: 2, type: 'link', title: 'Host Reconnected',     subtitle: '192.168.100.114',    time: '10:15 AM' },
  { id: 3, type: 'call', title: 'Missed Synced Call',   subtitle: '0321 8847 193',      time: 'Yesterday' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function nowTime() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function logIcon(type) {
  if (type === 'call')  return '📞';
  if (type === 'sms')   return '✉️';
  return '🔗';
}

// ─── Incoming Call Screen ─────────────────────────────────────────────────────
function IncomingCallOverlay({ number, onDecline, onAnswer }) {
  const fadeIn = useRef(new Animated.Value(0)).current;
  const slideUp = useRef(new Animated.Value(40)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeIn, {
        toValue: 1,
        duration: 320,
        useNativeDriver: true,
      }),
      Animated.timing(slideUp, {
        toValue: 0,
        duration: 320,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
    >
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
      <Animated.View style={[styles.callOverlayRoot, { opacity: fadeIn }]}>
        {/* Background gradient mimicking iOS default contact poster */}
        <LinearGradient
          colors={['#3a3a3c', '#1c1c1e', '#000000']}
          style={StyleSheet.absoluteFill}
        />

        {/* Top caller info area */}
        <Animated.View
          style={[
            styles.callTopSection,
            { transform: [{ translateY: slideUp }] },
          ]}
        >
          <SafeAreaView style={{ alignItems: 'center' }}>
            <Text style={styles.callNumberLabel}>{number || 'Unknown'}</Text>
            <Text style={styles.callSubLabel}>mobile</Text>
          </SafeAreaView>
        </Animated.View>

        {/* Bottom action area */}
        <Animated.View
          style={[
            styles.callBottomSection,
            { transform: [{ translateY: slideUp }], opacity: fadeIn },
          ]}
        >
          {/* Action buttons */}
          <View style={styles.callActionRow}>
            {/* Decline */}
            <View style={styles.callActionItem}>
              <TouchableOpacity
                style={styles.callDeclineButton}
                onPress={onDecline}
                activeOpacity={0.75}
              >
                <MaterialCommunityIcons name="phone-hangup" size={36} color="#ffffff" />
              </TouchableOpacity>
              <Text style={styles.callButtonLabel}>Decline</Text>
            </View>

            {/* Answer */}
            <View style={styles.callActionItem}>
              <TouchableOpacity
                style={styles.callAnswerButton}
                onPress={onAnswer}
                activeOpacity={0.75}
              >
                <MaterialCommunityIcons name="phone" size={36} color="#ffffff" />
              </TouchableOpacity>
              <Text style={styles.callButtonLabel}>Accept</Text>
            </View>
          </View>

          <SafeAreaView style={{ height: 20 }} />
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

// ─── Screen Components ────────────────────────────────────────────────────────

function StatusScreen({ signal, uptime, activityLog }) {
  return (
    <ScrollView contentContainerStyle={styles.scrollBody} showsVerticalScrollIndicator={false}>
      {/* Status Card */}
      <BlurView intensity={28} tint="dark" style={styles.statusCard}>
        <View style={styles.statusRingWrapper}>
          <View style={styles.radarRingOuter}>
            <View style={styles.radarRingMid}>
              <View style={styles.radarCore}>
                <Text style={styles.radarGlyph}>◉</Text>
              </View>
            </View>
          </View>
        </View>
        <View style={styles.statusTextBlock}>
          <Text style={styles.statusPrimary}>Listening Offline</Text>
          <Text style={styles.statusSecondary}>
            on Port <Text style={styles.monoGreen}>8080</Text>
          </Text>
        </View>
      </BlurView>

      {/* Activity Preview */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>RECENT ACTIVITY</Text>
        <View style={styles.listCard}>
          {activityLog.slice(0, 3).map((item, idx) => (
            <View key={item.id}>
              <View style={styles.listRow}>
                <View style={styles.listIconWrap}>
                  <Text style={styles.listIcon}>{logIcon(item.type)}</Text>
                </View>
                <View style={styles.listTextWrap}>
                  <Text style={styles.listTitle}>{item.title}</Text>
                  <Text style={styles.listSub}>{item.subtitle}</Text>
                </View>
                <Text style={styles.listTime}>{item.time}</Text>
              </View>
              {idx < 2 && idx < activityLog.length - 1 && <View style={styles.listSeparator} />}
            </View>
          ))}
        </View>
      </View>

      {/* Metrics Grid */}
      <View style={styles.metricsRow}>
        <View style={[styles.metricCard, { marginRight: 8 }]}>
          <Text style={styles.sectionLabel}>SIGNAL</Text>
          <View style={styles.metricValueWrap}>
            <Text style={styles.metricGreen}>{signal}</Text>
          </View>
        </View>
        <View style={[styles.metricCard, { marginLeft: 8 }]}>
          <Text style={styles.sectionLabel}>UPTIME</Text>
          <View style={styles.metricValueWrap}>
            <Text style={styles.metricWhite}>{uptime}</Text>
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

function NetworkScreen() {
  return (
    <ScrollView contentContainerStyle={styles.scrollBody} showsVerticalScrollIndicator={false}>
      <Text style={styles.pageTitle}>Network Diagnostics</Text>
      
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>CONNECTION DETAILS</Text>
        <View style={styles.listCard}>
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>Host IP</Text>
            <Text style={styles.monoValue}>192.168.100.130</Text>
          </View>
          <View style={styles.listSeparator} />
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>Listener Port</Text>
            <Text style={styles.monoValue}>8080</Text>
          </View>
          <View style={styles.listSeparator} />
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>Protocol</Text>
            <Text style={styles.monoValue}>UDP/IPv4</Text>
          </View>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>LATENCY / PING</Text>
        <View style={[styles.listCard, { alignItems: 'center', paddingVertical: 30 }]}>
          <Text style={styles.pingValueText}>12<Text style={styles.pingMsText}>ms</Text></Text>
          <Text style={styles.pingSubText}>Excellent connection to Host</Text>
        </View>
      </View>
    </ScrollView>
  );
}

function LogsScreen({ activityLog }) {
  const [filter, setFilter] = useState('All'); // All, Calls, System

  const filteredLogs = activityLog.filter(log => {
    if (filter === 'Calls') return log.type === 'call';
    if (filter === 'System') return log.type === 'link';
    return true;
  });

  return (
    <View style={{ flex: 1 }}>
      {/* iOS Segmented Control Mockup */}
      <View style={styles.segmentedControlContainer}>
        {['All', 'Calls', 'System'].map(f => (
          <TouchableOpacity 
            key={f} 
            style={[styles.segmentButton, filter === f && styles.segmentButtonActive]}
            onPress={() => setFilter(f)}
          >
            <Text style={[styles.segmentLabel, filter === f && styles.segmentLabelActive]}>{f}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView contentContainerStyle={[styles.scrollBody, { paddingTop: 10 }]} showsVerticalScrollIndicator={false}>
        <View style={styles.listCard}>
          {filteredLogs.map((item, idx) => (
            <View key={item.id}>
              <View style={styles.listRow}>
                <View style={styles.listIconWrap}>
                  <Text style={styles.listIcon}>{logIcon(item.type)}</Text>
                </View>
                <View style={styles.listTextWrap}>
                  <Text style={styles.listTitle}>{item.title}</Text>
                  <Text style={styles.listSub}>{item.subtitle}</Text>
                </View>
                <Text style={styles.listTime}>{item.time}</Text>
              </View>
              {idx < filteredLogs.length - 1 && <View style={styles.listSeparator} />}
            </View>
          ))}
          {filteredLogs.length === 0 && (
            <View style={{ padding: 24, alignItems: 'center' }}>
              <Text style={{ color: C.gray }}>No logs found for this category.</Text>
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function SettingsScreen() {
  const [settings, setSettings] = useState({
    silentMode: false,
    autoSync: true,
    background: true,
    haptic: true
  });

  const toggle = (key) => setSettings(prev => ({ ...prev, [key]: !prev[key] }));

  return (
    <ScrollView contentContainerStyle={styles.scrollBody} showsVerticalScrollIndicator={false}>
      <Text style={styles.pageTitle}>Preferences</Text>
      
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>GENERAL</Text>
        <View style={styles.listCard}>
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>Silent Mode</Text>
            <Switch value={settings.silentMode} onValueChange={() => toggle('silentMode')} trackColor={{ true: C.green }} />
          </View>
          <View style={styles.listSeparator} />
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>Haptic Feedback</Text>
            <Switch value={settings.haptic} onValueChange={() => toggle('haptic')} trackColor={{ true: C.green }} />
          </View>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>NETWORK</Text>
        <View style={styles.listCard}>
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>Auto-Sync Contacts</Text>
            <Switch value={settings.autoSync} onValueChange={() => toggle('autoSync')} trackColor={{ true: C.green }} />
          </View>
          <View style={styles.listSeparator} />
          <View style={styles.settingRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.settingLabel}>Run in Background</Text>
              <Text style={styles.settingSubLabel}>Keep UDP port open when app is closed</Text>
            </View>
            <Switch value={settings.background} onValueChange={() => toggle('background')} trackColor={{ true: C.green }} />
          </View>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>ABOUT</Text>
        <View style={styles.listCard}>
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>Version</Text>
            <Text style={styles.settingValueText}>1.0.0</Text>
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [callStatus, setCallStatus]   = useState('IDLE'); // 'IDLE' | 'RINGING'
  const [callerNumber, setCallerNumber] = useState('');
  const [signal]                       = useState('-45 dBm');
  const [uptime]                       = useState('14h 22m');
  const [activityLog, setActivityLog]  = useState(INITIAL_LOG);

  const [activeTab, setActiveTab] = useState('Status');

  const TABS = [
    { key: 'Status',  icon: '◉'  },
    { key: 'Network', icon: '⌘'  },
    { key: 'Logs',    icon: '≡'  },
    { key: 'Settings',icon: '⚙'  },
  ];

  function appendLog(entry) {
    setActivityLog(prev => [
      { id: Date.now(), ...entry },
      ...prev,
    ].slice(0, 30));
  }

  // ── Background Audio Loop ───────────────────────────────────────────────────
  useEffect(() => {
    let soundObj = null;
    async function startSilentLoop() {
      try {
        await Audio.setAudioModeAsync({
          staysActiveInBackground: true,
          playsInSilentModeIOS: true,
          shouldDuckAndroid: false,
          playThroughEarpieceAndroid: false,
        });
        const { sound } = await Audio.Sound.createAsync(
          require('./assets/silent.wav'),
          { isLooping: true, shouldPlay: true, volume: 0 }
        );
        soundObj = sound;
        console.log('[AudioLoop] Background execution active.');
      } catch (e) {
        console.warn('[AudioLoop] Failed:', e.message);
      }
    }
    startSilentLoop();
    return () => {
      if (soundObj) soundObj.unloadAsync();
    };
  }, []);

  // ── UDP Socket & CallKit ────────────────────────────────────────────────────
  useEffect(() => {
    let socket = null;
    let audioSocket = null;
    try {
      if (!dgram || typeof dgram.createSocket !== 'function') {
        console.warn('[UDP] react-native-udp native module is not available in Expo Go. UI will run in offline demo mode.');
        return;
      }
      socket = dgram.createSocket({ type: 'udp4' });
      audioSocket = dgram.createSocket({ type: 'udp4' });

      socket.on('error', (err) => console.warn('[UDP 8080] Socket error:', err.message));
      audioSocket.on('error', (err) => console.warn('[UDP 8081] Audio socket error:', err.message));

      socket.bind(8080, () => console.log('[UDP] Bound to Command Port 8080'));
      audioSocket.bind(8081, () => console.log('[UDP] Bound to Audio Port 8081'));

      // 8081 Audio Receiver
      audioSocket.on('message', (msg) => {
        try {
          const base64Chunk = msg.toString('base64');
          AudioBridge.write(base64Chunk);
        } catch (e) {}
      });

      // CallKit Answer Listener
      const onCallAnswered = () => {
        if (socket) {
          const payload = JSON.stringify({ type: "CALL_ANSWERED", action: "ACCEPT" });
          socket.send(payload, undefined, undefined, 8080, '192.168.100.114');
        }
        AudioBridge.start((data) => {
          if (audioSocket) {
            const buffer = Buffer.from(data, 'base64');
            audioSocket.send(buffer, 0, buffer.length, 8081, '192.168.100.114', (err) => {});
          }
        });
        setCallStatus('IDLE'); // Typically we hide the incoming overlay once answered
      };

      // CallKit End Listener
      const onCallEnded = () => {
        if (socket) {
          const payload = JSON.stringify({ request: "Disconnect", passkey: "TALHA_SECURE_SYNC_2026" });
          socket.send(payload, undefined, undefined, 8080, '192.168.100.114');
        }
        AudioBridge.stop();
        setCallStatus('IDLE');
      };

      if (callKeepAvailable && RNCallKeep) {
        try {
          RNCallKeep.addEventListener('answerCall', onCallAnswered);
          RNCallKeep.addEventListener('endCall', onCallEnded);
        } catch (e) {}
      }

      // 8080 Command Receiver
      socket.on('message', (msg) => {
        try {
          const payload = JSON.parse(msg.toString());
          const time = nowTime();

          if (payload.type === 'CALL_ALERT') {
            const num = payload.number || 'Unknown';
            setCallerNumber(num);
            if (callKeepAvailable && RNCallKeep) {
              try {
                RNCallKeep.displayIncomingCall('local-link-call', num, num, 'number', false);
              } catch (e) {
                setCallStatus('RINGING'); // Fallback to React Native UI
              }
            } else {
              setCallStatus('RINGING'); // Use React Native overlay
            }
            appendLog({ type: 'call', title: 'Incoming Synced Call', subtitle: num, time });
          } else if (payload.type === 'CALL_CANCEL' || payload.type === 'CALL_ENDED') {
            const reason = payload.reason || payload.type;
            if (callKeepAvailable && RNCallKeep) {
              try {
                RNCallKeep.endCall('local-link-call');
                RNCallKeep.endAllCalls();
              } catch (e) {
                setCallStatus('IDLE');
              }
            } else {
              setCallStatus('IDLE');
            }
            setCallerNumber('');
            AudioBridge.stop();
            appendLog({
              type: 'call',
              title: payload.type === 'CALL_CANCEL' ? 'Call Dismissed on Host' : 'Call Ended',
              subtitle: reason,
              time,
            });
          }
        } catch (err) {
          console.warn('[UDP] Parse error:', err.message);
        }
      });
    } catch (e) {
      console.warn('[UDP] Initialization error:', e.message);
    }

    return () => {
      if (socket) { try { socket.close(); } catch (_) {} }
      if (audioSocket) { try { audioSocket.close(); } catch (_) {} }
      if (callKeepAvailable && RNCallKeep) {
        try {
          RNCallKeep.removeEventListener('answerCall');
          RNCallKeep.removeEventListener('endCall');
        } catch (e) {}
      }
    };
  }, []);

  // ── Ringing overlay handlers ────────────────────────────────────────────────

  function handleDecline() {
    appendLog({
      type: 'call',
      title: 'Call Declined Locally',
      subtitle: callerNumber,
      time: nowTime(),
    });
    setCallStatus('IDLE');
    setCallerNumber('');
  }

  function handleAnswer() {
    appendLog({
      type: 'call',
      title: 'Answered on Device',
      subtitle: callerNumber,
      time: nowTime(),
    });
    setCallStatus('IDLE');
    setCallerNumber('');
  }

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={C.black} />

      {/* ── Full-screen incoming call overlay ── */}
      {callStatus === 'RINGING' && (
        <IncomingCallOverlay
          number={callerNumber}
          onDecline={handleDecline}
          onAnswer={handleAnswer}
        />
      )}

      {/* ── Header ── */}
      <SafeAreaView style={styles.headerSafe}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.headerIconBtn} onPress={() => setActiveTab('Settings')}>
            <Text style={styles.headerIconText}>⚙</Text>
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>Local Link</Text>
          </View>
          <TouchableOpacity style={styles.headerIconBtn} onPress={() => setActiveTab('Network')}>
            <View style={styles.signalDot} />
            <Text style={styles.headerIconText}>  ⊕</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      {/* ── Dynamic Screen Content ── */}
      {activeTab === 'Status' && <StatusScreen signal={signal} uptime={uptime} activityLog={activityLog} />}
      {activeTab === 'Network' && <NetworkScreen />}
      {activeTab === 'Logs' && <LogsScreen activityLog={activityLog} />}
      {activeTab === 'Settings' && <SettingsScreen />}

      {/* ── Tab Bar ── */}
      <BlurView intensity={32} tint="dark" style={styles.tabBar}>
        <SafeAreaView style={styles.tabBarInner}>
          {TABS.map((tab) => {
            const isActive = activeTab === tab.key;
            return (
              <TouchableOpacity
                key={tab.key}
                style={styles.tabItem}
                onPress={() => setActiveTab(tab.key)}
                activeOpacity={0.7}
              >
                <Text style={[styles.tabIcon, isActive && styles.tabIconActive]}>
                  {tab.icon}
                </Text>
                <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>
                  {tab.key}
                </Text>
              </TouchableOpacity>
            );
          })}
        </SafeAreaView>
      </BlurView>
    </View>
  );
}

// ─── StyleSheet ───────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: C.black,
  },

  // ── Header ──
  headerSafe: {
    backgroundColor: 'rgba(0,0,0,0.85)',
    zIndex: 10,
  },
  header: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    borderBottomWidth: 0.5,
    borderBottomColor: C.separator,
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    color: C.white,
    fontSize: 17,
    fontWeight: '600',
    letterSpacing: -0.3,
  },
  headerIconBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerIconText: {
    color: C.green,
    fontSize: 18,
  },
  signalDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: C.green,
    position: 'absolute',
    top: 6,
    right: 8,
  },

  // ── Common Layout ──
  scrollBody: {
    paddingHorizontal: 16,
    paddingTop: 24,
    paddingBottom: 104,
    maxWidth: 440,
    alignSelf: 'center',
    width: '100%',
  },
  pageTitle: {
    color: C.white,
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 20,
    letterSpacing: -0.5,
  },
  section: {
    marginBottom: 24,
  },
  sectionLabel: {
    color: C.gray,
    fontSize: 12,
    fontWeight: '500',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    marginBottom: 8,
    paddingLeft: 4,
  },

  // ── Status Card ──
  statusCard: {
    borderRadius: 12,
    borderWidth: 0.5,
    borderColor: C.border,
    overflow: 'hidden',
    alignItems: 'center',
    paddingVertical: 40,
    paddingHorizontal: 24,
    marginBottom: 24,
  },
  statusRingWrapper: {
    marginBottom: 28,
  },
  radarRingOuter: {
    width: 144,
    height: 144,
    borderRadius: 72,
    borderWidth: 0.5,
    borderColor: C.greenRing,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radarRingMid: {
    width: 108,
    height: 108,
    borderRadius: 54,
    borderWidth: 0.5,
    borderColor: C.greenDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radarCore: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: C.greenDim,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 0.5,
    borderColor: C.green,
  },
  radarGlyph: {
    fontSize: 28,
    color: C.green,
  },
  statusTextBlock: {
    alignItems: 'center',
  },
  statusPrimary: {
    color: C.green,
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: -0.2,
    marginBottom: 6,
  },
  statusSecondary: {
    color: C.gray,
    fontSize: 13,
    letterSpacing: 0.1,
  },
  monoGreen: {
    color: C.green,
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
    fontWeight: '600',
  },

  // ── List & Settings Cards ──
  listCard: {
    backgroundColor: C.surfaceSolid,
    borderRadius: 12,
    borderWidth: 0.5,
    borderColor: C.border,
    overflow: 'hidden',
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  listIconWrap: {
    width: 32,
    alignItems: 'center',
  },
  listIcon: {
    fontSize: 18,
  },
  listTextWrap: {
    flex: 1,
    paddingRight: 8,
    justifyContent: 'center',
  },
  listTitle: {
    color: C.white,
    fontSize: 16,
    fontWeight: '500',
    letterSpacing: -0.3,
  },
  listSub: {
    color: C.gray,
    fontSize: 13,
    marginTop: 2,
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
  },
  listTime: {
    color: C.gray,
    fontSize: 14,
  },
  listSeparator: {
    height: 0.5,
    backgroundColor: C.separator,
    marginLeft: 48,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: 52,
  },
  settingLabel: {
    color: C.white,
    fontSize: 16,
    fontWeight: '500',
    letterSpacing: -0.3,
  },
  settingSubLabel: {
    color: C.gray,
    fontSize: 13,
    marginTop: 2,
  },
  settingValueText: {
    color: C.gray,
    fontSize: 16,
  },
  monoValue: {
    color: C.gray,
    fontSize: 15,
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
  },

  // ── Metrics Row ──
  metricsRow: {
    flexDirection: 'row',
    marginBottom: 20,
  },
  metricCard: {
    flex: 1,
    backgroundColor: C.surfaceSolid,
    borderRadius: 12,
    borderWidth: 0.5,
    borderColor: C.border,
    padding: 14,
  },
  metricValueWrap: {
    marginTop: 8,
  },
  metricGreen: {
    color: C.green,
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
    fontSize: 18,
    fontWeight: '600',
  },
  metricWhite: {
    color: C.white,
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
    fontSize: 18,
    fontWeight: '600',
  },

  // ── Network Screen specifics ──
  pingValueText: {
    color: C.green,
    fontSize: 48,
    fontWeight: '600',
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
  },
  pingMsText: {
    color: C.green,
    fontSize: 24,
    fontWeight: '400',
  },
  pingSubText: {
    color: C.gray,
    fontSize: 14,
    marginTop: 8,
  },

  // ── Logs Screen Segmented Control ──
  segmentedControlContainer: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 16,
    backgroundColor: '#1c1c1e',
    borderRadius: 8,
    padding: 2,
    borderWidth: 0.5,
    borderColor: C.border,
  },
  segmentButton: {
    flex: 1,
    paddingVertical: 6,
    alignItems: 'center',
    borderRadius: 6,
  },
  segmentButtonActive: {
    backgroundColor: '#3a3a3c',
  },
  segmentLabel: {
    color: C.white,
    fontSize: 13,
    fontWeight: '500',
  },
  segmentLabelActive: {
    color: C.white,
    fontWeight: '600',
  },

  // ── Tab Bar ──
  tabBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    borderTopWidth: 0.5,
    borderTopColor: C.separator,
  },
  tabBarInner: {
    flexDirection: 'row',
    paddingTop: 10,
    paddingBottom: Platform.OS === 'ios' ? 4 : 10,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
  },
  tabIcon: {
    fontSize: 20,
    color: C.gray,
    marginBottom: 4,
  },
  tabIconActive: {
    color: C.green,
  },
  tabLabel: {
    fontSize: 10,
    fontWeight: '500',
    color: C.gray,
    letterSpacing: 0.2,
  },
  tabLabelActive: {
    color: C.green,
  },

  // ── Incoming Call Overlay ──
  callOverlayRoot: {
    flex: 1,
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
    backgroundColor: '#000',
    justifyContent: 'space-between',
  },
  callTopSection: {
    flex: 1,
    paddingTop: Platform.OS === 'ios' ? 80 : 60,
  },
  callNumberLabel: {
    color: '#ffffff',
    fontSize: 42,
    fontWeight: '400',
    letterSpacing: -0.5,
    textAlign: 'center',
    marginBottom: 8,
  },
  callSubLabel: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 18,
    fontWeight: '400',
    textAlign: 'center',
  },
  callBottomSection: {
    paddingBottom: Platform.OS === 'ios' ? 40 : 28,
  },
  callActionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 48,
    alignItems: 'center',
    marginBottom: 20,
  },
  callActionItem: {
    alignItems: 'center',
  },
  callDeclineButton: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: '#FF3B30',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  callAnswerButton: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: '#34C759',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  callButtonLabel: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '400',
    letterSpacing: 0.1,
  },
});