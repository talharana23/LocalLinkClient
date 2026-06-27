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
  TextInput,
  TouchableOpacity,
  View,
  Switch,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';

import { Buffer } from 'buffer';
import InCallManager from 'react-native-incall-manager';

// ── Background Notification Setup ──
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// ── Safe native module imports (these may not be linked in all environments) ──
let dgram = null;
try { dgram = require('react-native-udp'); } catch (e) { console.warn('[UDP] Native module not available:', e.message); }

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
}

AudioBridge.init();

// ── PCM Player: plays incoming raw PCM audio via expo-av + temp WAV files ──
// Android Host sends raw PCM bytes on port 8081. We buffer them, wrap in a WAV
// header, write to a temp file, and play with Audio.Sound. Double-buffered
// (alternating 2 file slots) so playback is near-continuous.
class PCMPlayer {
  constructor() {
    this.active = false;
    this.chunks = [];
    this.timer = null;
    this.sounds = [null, null];
    this.fileIdx = 0;
  }

  async start() {
    this.active = true;
    this.chunks = [];
    this.fileIdx = 0;
    // Removed Audio.setAudioModeAsync to prevent clashing with InCallManager which causes the crash
    // Flush every 250ms (~35 chunks of audio at 44100Hz)
    this.timer = setInterval(() => this._flush(), 250);
  }

  feed(rawPcmBuffer) {
    if (this.active) this.chunks.push(rawPcmBuffer);
  }

  async _flush() {
    if (this.chunks.length === 0) return;
    const batch = this.chunks.splice(0);
    const pcm = Buffer.concat(batch);
    if (pcm.length === 0) return;

    const wav = PCMPlayer.createWav(pcm);
    const slot = this.fileIdx % 2;
    this.fileIdx++;
    const uri = FileSystem.cacheDirectory + `_call_pcm_${slot}.wav`;

    try {
      await FileSystem.writeAsStringAsync(uri, wav.toString('base64'), {
        encoding: FileSystem.EncodingType.Base64,
      });
      // Unload previous sound in this slot
      if (this.sounds[slot]) {
        try { await this.sounds[slot].unloadAsync(); } catch (_) {}
      }
      const { sound } = await Audio.Sound.createAsync(
        { uri },
        { shouldPlay: true, volume: 1.0 }
      );
      this.sounds[slot] = sound;
    } catch (e) {
      console.warn('[PCMPlayer] flush error:', e.message);
    }
  }

  async stop() {
    this.active = false;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.chunks = [];
    for (const s of this.sounds) {
      if (s) try { await s.unloadAsync(); } catch (_) {}
    }
    this.sounds = [null, null];
  }

  // Build a valid WAV file from raw PCM data (16-bit, mono, 44100Hz)
  static createWav(pcmData, sampleRate = 44100) {
    const n = pcmData.length;
    const h = Buffer.alloc(44);
    h.write('RIFF', 0);       h.writeUInt32LE(36 + n, 4);
    h.write('WAVE', 8);       h.write('fmt ', 12);
    h.writeUInt32LE(16, 16);  h.writeUInt16LE(1, 20);       // PCM format
    h.writeUInt16LE(1, 22);   h.writeUInt32LE(sampleRate, 24);   // Mono, sampleRate Hz
    h.writeUInt32LE(sampleRate * 2, 28); h.writeUInt16LE(2, 32);     // Byte rate, block align
    h.writeUInt16LE(16, 34);  h.write('data', 36);          // 16-bit
    h.writeUInt32LE(n, 40);
    return Buffer.concat([h, pcmData]);
  }
}

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
    <Modal visible transparent animationType="none" statusBarTranslucent>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
      <Animated.View style={[styles.callOverlayRoot, { opacity: fadeIn }]}>
        <LinearGradient colors={['#3a3a3c', '#1c1c1e', '#000000']} style={StyleSheet.absoluteFill} />
        
        <Animated.View style={[styles.callTopSection, { transform: [{ translateY: slideUp }] }]}>
          <SafeAreaView style={{ alignItems: 'center' }}>
            <Text style={styles.callNumberLabel}>{number || 'Unknown'}</Text>
            <Text style={styles.callSubLabel}>Incoming Host Call</Text>
          </SafeAreaView>
        </Animated.View>

        <Animated.View style={[styles.callBottomSection, { transform: [{ translateY: slideUp }], opacity: fadeIn }]}>
          <View style={styles.callActionRow}>
            <View style={styles.callActionItem}>
              <TouchableOpacity style={styles.callDeclineButton} onPress={onDecline} activeOpacity={0.75}>
                <MaterialCommunityIcons name="phone-hangup" size={36} color="#ffffff" />
              </TouchableOpacity>
              <Text style={styles.callButtonLabel}>Decline</Text>
            </View>

            <View style={styles.callActionItem}>
              <TouchableOpacity style={styles.callAnswerButton} onPress={onAnswer} activeOpacity={0.75}>
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

// ─── Screen Components ────────────────────────────────────────────────────────

function StatusScreen({ signal, uptime, activityLog, onConnect, onDisconnect }) {
  const isConnected = signal === 'Connected';
  const isConnecting = signal === 'Connecting...';

  return (
    <ScrollView contentContainerStyle={styles.scrollBody} showsVerticalScrollIndicator={false}>
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
          <Text style={styles.statusPrimary}>{isConnected ? 'Listening Online' : isConnecting ? 'Connecting...' : 'Offline'}</Text>
          <Text style={styles.statusSecondary}>
            on Port <Text style={styles.monoGreen}>8080</Text>
          </Text>
          <TouchableOpacity 
            style={[styles.connectButton, isConnected ? styles.disconnectButton : null, isConnecting && {opacity: 0.5}]} 
            onPress={isConnected ? onDisconnect : onConnect}
            disabled={isConnecting}
          >
            <Text style={styles.connectButtonText}>{isConnected ? 'Disconnect' : isConnecting ? 'Connecting...' : 'Connect to Host'}</Text>
          </TouchableOpacity>
        </View>
      </BlurView>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>RECENT ACTIVITY</Text>
        <View style={styles.listCard}>
          {activityLog.length === 0 ? (
            <View style={{ padding: 24, alignItems: 'center' }}><Text style={{ color: C.gray }}>No recent activity</Text></View>
          ) : (
            activityLog.slice(0, 3).map((item, idx) => (
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
            ))
          )}
        </View>
      </View>

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

function NetworkScreen({ hostIP, onSaveIP, onDiscover }) {
  const [tempIP, setTempIP] = useState(hostIP);

  useEffect(() => { setTempIP(hostIP); }, [hostIP]);

  return (
    <ScrollView contentContainerStyle={styles.scrollBody} showsVerticalScrollIndicator={false}>
      <Text style={styles.pageTitle}>Network Diagnostics</Text>

      <TouchableOpacity style={styles.discoverButton} onPress={onDiscover}>
        <Text style={styles.discoverButtonText}>Scan / Auto-Connect</Text>
      </TouchableOpacity>
      
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>CONNECTION DETAILS</Text>
        <View style={styles.listCard}>
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>Host IP</Text>
            <TextInput 
              style={styles.textInput}
              value={tempIP}
              onChangeText={setTempIP}
              onBlur={() => onSaveIP(tempIP)}
              keyboardType="numeric"
              returnKeyType="done"
            />
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
          <Text style={styles.pingValueText}>---<Text style={styles.pingMsText}>ms</Text></Text>
          <Text style={styles.pingSubText}>Waiting for Host Ping</Text>
        </View>
      </View>
    </ScrollView>
  );
}

function LogsScreen({ activityLog }) {
  const [filter, setFilter] = useState('All'); 

  const filteredLogs = activityLog.filter(log => {
    if (filter === 'Calls') return log.type === 'call';
    if (filter === 'System') return log.type === 'link';
    return true;
  });

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.segmentedControlContainer}>
        {['All', 'Calls', 'System'].map(f => (
          <TouchableOpacity key={f} style={[styles.segmentButton, filter === f && styles.segmentButtonActive]} onPress={() => setFilter(f)}>
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
            <Text style={styles.settingValueText}>1.1.0</Text>
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [callStatus, setCallStatus]   = useState('IDLE'); // 'IDLE' | 'RINGING' | 'ACTIVE'
  const [callerNumber, setCallerNumber] = useState('');
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState(false);
  const isMutedRef = useRef(false);

  useEffect(() => { isMutedRef.current = isMuted; }, [isMuted]);
  const [signal, setSignal]            = useState('Offline');
  const [uptime]                       = useState('Online');
  const [activityLog, setActivityLog]  = useState([]);
  const [hostIP, setHostIP]            = useState('192.168.100.114');

  const [activeTab, setActiveTab] = useState('Status');

  const socketRef = useRef(null);
  const audioSocketRef = useRef(null);
  const hostIPRef = useRef(hostIP);
  const ringtoneRef = useRef(null);
  const pcmPlayerRef = useRef(new PCMPlayer());
  const keepAliveSoundRef = useRef(null);

  const TABS = [
    { key: 'Status',  icon: '◉'  },
    { key: 'Network', icon: '⌘'  },
    { key: 'Logs',    icon: '≡'  },
    { key: 'Settings',icon: '⚙'  },
  ];

  // ── Helper: stop the foreground ringtone ──
  // ── Helper: stop the foreground ringtone ──
  async function stopRingtoneSound() {
    try {
      if (ringtoneRef.current) {
        await ringtoneRef.current.stopAsync();
        await ringtoneRef.current.unloadAsync();
        ringtoneRef.current = null;
      }
    } catch (e) {}
  }

  // ── Helper: play the foreground ringtone ──
  async function playRingtoneSound() {
    try {
      await stopRingtoneSound();
      await Audio.setAudioModeAsync({
        staysActiveInBackground: true,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: false,
        playThroughEarpieceAndroid: false,
      });
      const { sound } = await Audio.Sound.createAsync(
        require('./assets/ringtone.wav'),
        { isLooping: true, shouldPlay: true, volume: 1.0 }
      );
      ringtoneRef.current = sound;
    } catch (e) {
      console.warn('[Ringtone] Play failed:', e.message);
    }
  }

  // ── Helper: Start Background Keepalive ──
  // InCallManager.stop() deactivates the iOS AVAudioSession, which kills our background audio loop.
  // We must re-init it whenever we go back to IDLE to ensure we can receive the next call in the background.
  async function startKeepAlive() {
    if (keepAliveSoundRef.current) {
      try {
        await keepAliveSoundRef.current.stopAsync();
        await keepAliveSoundRef.current.unloadAsync();
      } catch (e) {}
      keepAliveSoundRef.current = null;
    }
    try {
      await Audio.setAudioModeAsync({
        staysActiveInBackground: true,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: false,
        playThroughEarpieceAndroid: false,
      });

      // Generate 1 second of silence
      const silentPcm = Buffer.alloc(88200, 0);
      const silentWav = PCMPlayer.createWav(silentPcm, 44100);
      const silentUri = FileSystem.cacheDirectory + '_bg_silent.wav';
      await FileSystem.writeAsStringAsync(silentUri, silentWav.toString('base64'), {
        encoding: FileSystem.EncodingType.Base64,
      });

      const { sound } = await Audio.Sound.createAsync(
        { uri: silentUri },
        { isLooping: true, shouldPlay: true, volume: 0.01 }
      );
      keepAliveSoundRef.current = sound;
      console.log('[AudioLoop] Background keepalive active (generated 1s silent WAV).');
    } catch (e) {
      console.warn('[AudioLoop] Failed:', e.message);
    }
  }

  useEffect(() => {
    startKeepAlive();
    
    AsyncStorage.getItem('hostIP').then(ip => {
      if (ip) {
        setHostIP(ip);
        hostIPRef.current = ip;
      }
    });
    
    // Request notification permissions
    Notifications.requestPermissionsAsync();

    // ── Create Android notification channel with MAX importance & custom sound ──
    if (Platform.OS === 'android') {
      Notifications.setNotificationChannelAsync('incoming-calls', {
        name: 'Incoming Calls',
        importance: Notifications.AndroidImportance.MAX,
        sound: null,
        vibrationPattern: [0, 500, 250, 500],
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
        bypassDnd: true,
        enableVibrate: true,
      });
    }

    // ── Notification tap listener — brings app to foreground showing the call UI ──
    const notifResponseSub = Notifications.addNotificationResponseReceivedListener(response => {
      // When user taps the notification, the app is brought to foreground automatically.
      // The RINGING state and overlay are already set, so user will see the call screen.
      console.log('[Notification] User tapped notification to receive call.');
    });

    return () => {
      notifResponseSub.remove();
      if (keepAliveSoundRef.current) keepAliveSoundRef.current.unloadAsync();
    };
  }, []);

  const handleSaveIP = (ip) => {
    setHostIP(ip);
    hostIPRef.current = ip;
    AsyncStorage.setItem('hostIP', ip);
  };

  function appendLog(entry) {
    setActivityLog(prev => [{ id: Date.now(), ...entry }, ...prev].slice(0, 50));
  }

  const handleConnect = () => {
    setSignal('Connecting...');
    if (socketRef.current) {
      const payload = JSON.stringify({ request: "Connect", passkey: "TALHA_SECURE_SYNC_2026" });
      socketRef.current.send(payload, 0, payload.length, 8080, hostIPRef.current);
      appendLog({ type: 'link', title: 'Handshake Sent', subtitle: hostIPRef.current, time: nowTime() });
    }
  };

  const handleDisconnect = () => {
    if (socketRef.current) {
      const payload = JSON.stringify({ type: "Disconnect", passkey: "TALHA_SECURE_SYNC_2026" });
      socketRef.current.send(payload, 0, payload.length, 8080, hostIPRef.current);
    }
    setSignal('Offline');
    appendLog({ type: 'link', title: 'Disconnected from Host', subtitle: 'User initiated', time: nowTime() });
  };

  const handleDiscover = () => {
    if (socketRef.current) {
      const payload = JSON.stringify({ request: "Connect", passkey: "TALHA_SECURE_SYNC_2026" });
      socketRef.current.send(payload, 0, payload.length, 8080, "255.255.255.255");
      appendLog({ type: 'link', title: 'Discovery Broadcast', subtitle: 'Scanning network...', time: nowTime() });
    }
  };

  // ── Background Audio Loop removed from here, integrated above ──

  // ── UDP Sockets ─────────────────────────────────────────────────────────────
  useEffect(() => {
    try {
      if (!dgram || typeof dgram.createSocket !== 'function') {
        console.warn('[UDP] react-native-udp native module not available. App will run in offline mode.');
        return;
      }
      const socket = dgram.createSocket({ type: 'udp4' });
      const audioSocket = dgram.createSocket({ type: 'udp4' });
      socketRef.current = socket;
      audioSocketRef.current = audioSocket;

      socket.on('error', (err) => console.warn('[UDP 8080] Socket error:', err.message));
      audioSocket.on('error', (err) => console.warn('[UDP 8081] Audio socket error:', err.message));

      socket.bind(8080, () => {
        console.log('[UDP] Bound to Command Port 8080');
        try { socket.setBroadcast(true); } catch(e) {}
      });
      audioSocket.bind(8081, () => console.log('[UDP] Bound to Audio Port 8081'));

      // 8081 Audio Receiver (Playing Host Audio)
      // Android Host now sends RAW PCM bytes (not Base64). We feed them
      // directly to the PCMPlayer which buffers, wraps in WAV, and plays.
      audioSocket.on('message', (msg) => {
        try {
          pcmPlayerRef.current.feed(msg);
        } catch (e) {}
      });

      // 8080 Command Receiver
      socket.on('message', (msg, rinfo) => {
        try {
          const payload = JSON.parse(msg.toString());
          const time = nowTime();

          // Auto-Discovery: If we receive any known Host packet from a new IP, hook onto it!
          if (rinfo && rinfo.address && rinfo.address !== hostIPRef.current) {
            if (payload.status === 'CONNECTED' || payload.type === 'CALL_ALERT' || payload.status === 'DISCONNECTED') {
               setHostIP(rinfo.address);
               hostIPRef.current = rinfo.address;
               AsyncStorage.setItem('hostIP', rinfo.address);
            }
          }

          if (payload.status === 'CONNECTED') {
            setSignal('Connected');
            appendLog({ type: 'link', title: 'Connected to Host', subtitle: hostIPRef.current, time });
          } else if (payload.status === 'DISCONNECTED') {
            setSignal('Offline');
            appendLog({ type: 'link', title: 'Session Terminated', subtitle: payload.message || 'Graceful disconnect', time });
          } else if (payload.type === 'CALL_ALERT') {
            const num = payload.number || 'Unknown';
            setCallerNumber(num);
            setCallStatus('RINGING');
            appendLog({ type: 'call', title: 'Incoming Host Call', subtitle: num, time });
            
              Notifications.scheduleNotificationAsync({
                content: {
                  title: `Incoming Call — ${num}`,
                  body: 'Tap to receive call',
                  sound: null, // Silent notification to prevent ducking
                  priority: Notifications.AndroidNotificationPriority.MAX,
                  sticky: true,
                  ...(Platform.OS === 'android' ? { channelId: 'incoming-calls' } : {}),
                },
                trigger: null,
              });
              // Play custom ringtone to ensure it rings in background without interruption
              playRingtoneSound();
              try { InCallManager.startRingtone('_BUNDLE_'); } catch(e) {}
            } else if (payload.type === 'CALL_CANCEL' || payload.type === 'CALL_ENDED') {
              const reason = payload.reason || payload.type;
              setCallStatus('IDLE');
              setCallerNumber('');
              AudioBridge.stop();
              pcmPlayerRef.current.stop();
              Notifications.dismissAllNotificationsAsync();
              stopRingtoneSound();
              try { InCallManager.stopRingtone(); InCallManager.stop(); } catch(e) {}
              
              // Restart keepalive loop because InCallManager.stop() deactivated the audio session
              startKeepAlive();

              appendLog({
                type: 'call',
                title: payload.type === 'CALL_CANCEL' ? (reason === 'ANSWERED_ON_HOST' ? 'Answered on Host' : 'Call Dismissed on Host') : 'Call Ended',
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
      if (socketRef.current) { try { socketRef.current.close(); } catch (_) {} }
      if (audioSocketRef.current) { try { audioSocketRef.current.close(); } catch (_) {} }
    };
  }, []);

  // ── Ringing overlay handlers ────────────────────────────────────────────────

  async function handleDecline() {
    appendLog({
      type: 'call',
      title: 'Call Declined Locally',
      subtitle: callerNumber,
      time: nowTime(),
    });
    setCallStatus('IDLE');
    setCallerNumber('');
    Notifications.dismissAllNotificationsAsync();
    await stopRingtoneSound();
    try { InCallManager.stopRingtone(); InCallManager.stop(); } catch(e) {}
    
    // Restart keepalive loop because InCallManager.stop() deactivated the audio session
    startKeepAlive();
    
    if (socketRef.current) {
      const payload = JSON.stringify({ type: "CALL_ANSWERED", action: "DECLINE" });
      socketRef.current.send(payload, 0, payload.length, 8080, hostIPRef.current);
    }
  }

  async function handleAnswer() {
    appendLog({
      type: 'call',
      title: 'Answered on Device',
      subtitle: callerNumber,
      time: nowTime(),
    });
    setCallStatus('ACTIVE');
    Notifications.dismissAllNotificationsAsync();

    // MUST await ringtone stop to prevent AudioSession crash when InCallManager starts
    await stopRingtoneSound();

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

    // Start the PCM player to hear Android's audio
    await pcmPlayerRef.current.start();
    
    // Start microphone streaming to Host IP
    // LiveAudioStream provides data as a Base64 string.
    // Android Host now accepts raw PCM bytes, so we decode Base64 → raw bytes before sending.
    AudioBridge.start((data) => {
      if (audioSocketRef.current && !isMutedRef.current) {
        const pcmBytes = Buffer.from(data, 'base64');
        audioSocketRef.current.send(pcmBytes, 0, pcmBytes.length, 8081, hostIPRef.current, (err) => {});
      }
    });
  }

  function handleEndCall() {
    setCallStatus('IDLE');
    setCallerNumber('');
    AudioBridge.stop();
    pcmPlayerRef.current.stop();
    try { InCallManager.stop(); } catch(e) {}
    
    // Restart keepalive loop because InCallManager.stop() deactivated the audio session
    startKeepAlive();
    
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
      {activeTab === 'Status' && <StatusScreen signal={signal} uptime={uptime} activityLog={activityLog} onConnect={handleConnect} onDisconnect={handleDisconnect} />}
      {activeTab === 'Network' && <NetworkScreen hostIP={hostIP} onSaveIP={handleSaveIP} onDiscover={handleDiscover} />}
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
  root: { flex: 1, backgroundColor: C.black },
  headerSafe: { backgroundColor: 'rgba(0,0,0,0.85)', zIndex: 10 },
  header: { height: 52, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, borderBottomWidth: 0.5, borderBottomColor: C.separator },
  headerTitle: { flex: 1, textAlign: 'center', color: C.white, fontSize: 17, fontWeight: '600', letterSpacing: -0.3 },
  headerIconBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerIconText: { color: C.green, fontSize: 18 },
  signalDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.green, position: 'absolute', top: 6, right: 8 },
  scrollBody: { paddingHorizontal: 16, paddingTop: 24, paddingBottom: 104, maxWidth: 440, alignSelf: 'center', width: '100%' },
  pageTitle: { color: C.white, fontSize: 28, fontWeight: '700', marginBottom: 20, letterSpacing: -0.5 },
  section: { marginBottom: 24 },
  sectionLabel: { color: C.gray, fontSize: 12, fontWeight: '500', letterSpacing: 0.7, textTransform: 'uppercase', marginBottom: 8, paddingLeft: 4 },
  statusCard: { borderRadius: 12, borderWidth: 0.5, borderColor: C.border, overflow: 'hidden', alignItems: 'center', paddingVertical: 40, paddingHorizontal: 24, marginBottom: 24 },
  statusRingWrapper: { marginBottom: 28 },
  radarRingOuter: { width: 144, height: 144, borderRadius: 72, borderWidth: 0.5, borderColor: C.greenRing, alignItems: 'center', justifyContent: 'center' },
  radarRingMid: { width: 108, height: 108, borderRadius: 54, borderWidth: 0.5, borderColor: C.greenDim, alignItems: 'center', justifyContent: 'center' },
  radarCore: { width: 72, height: 72, borderRadius: 36, backgroundColor: C.greenDim, alignItems: 'center', justifyContent: 'center', borderWidth: 0.5, borderColor: C.green },
  radarGlyph: { fontSize: 28, color: C.green },
  statusTextBlock: { alignItems: 'center' },
  statusPrimary: { color: C.green, fontSize: 16, fontWeight: '600', letterSpacing: -0.2, marginBottom: 6 },
  statusSecondary: { color: C.gray, fontSize: 13, letterSpacing: 0.1 },
  connectButton: { marginTop: 16, backgroundColor: C.green, paddingHorizontal: 24, paddingVertical: 10, borderRadius: 20 },
  disconnectButton: { backgroundColor: C.red },
  connectButtonText: { color: C.black, fontWeight: '600', fontSize: 14 },
  monoGreen: { color: C.green, fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace', fontWeight: '600' },
  listCard: { backgroundColor: C.surfaceSolid, borderRadius: 12, borderWidth: 0.5, borderColor: C.border, overflow: 'hidden' },
  listRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  listIconWrap: { width: 32, alignItems: 'center' },
  listIcon: { fontSize: 18 },
  listTextWrap: { flex: 1, paddingRight: 8, justifyContent: 'center' },
  listTitle: { color: C.white, fontSize: 16, fontWeight: '500', letterSpacing: -0.3 },
  listSub: { color: C.gray, fontSize: 13, marginTop: 2, fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace' },
  listTime: { color: C.gray, fontSize: 14 },
  listSeparator: { height: 0.5, backgroundColor: C.separator, marginLeft: 48 },
  settingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, minHeight: 52 },
  settingLabel: { color: C.white, fontSize: 16, fontWeight: '500', letterSpacing: -0.3 },
  settingSubLabel: { color: C.gray, fontSize: 13, marginTop: 2 },
  settingValueText: { color: C.gray, fontSize: 16 },
  monoValue: { color: C.gray, fontSize: 15, fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace' },
  textInput: { color: C.green, fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace', fontSize: 16, padding: 0, margin: 0, minWidth: 140, textAlign: 'right' },
  discoverButton: { backgroundColor: '#3a3a3c', padding: 12, borderRadius: 8, alignItems: 'center', marginBottom: 24, borderWidth: 0.5, borderColor: C.border },
  discoverButtonText: { color: C.white, fontWeight: '600', fontSize: 15 },
  metricsRow: { flexDirection: 'row', marginBottom: 20 },
  metricCard: { flex: 1, backgroundColor: C.surfaceSolid, borderRadius: 12, borderWidth: 0.5, borderColor: C.border, padding: 14 },
  metricValueWrap: { marginTop: 8 },
  metricGreen: { color: C.green, fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace', fontSize: 18, fontWeight: '600' },
  metricWhite: { color: C.white, fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace', fontSize: 18, fontWeight: '600' },
  pingValueText: { color: C.green, fontSize: 48, fontWeight: '600', fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace' },
  pingMsText: { color: C.green, fontSize: 24, fontWeight: '400' },
  pingSubText: { color: C.gray, fontSize: 14, marginTop: 8 },
  segmentedControlContainer: { flexDirection: 'row', marginHorizontal: 16, marginTop: 16, backgroundColor: '#1c1c1e', borderRadius: 8, padding: 2, borderWidth: 0.5, borderColor: C.border },
  segmentButton: { flex: 1, paddingVertical: 6, alignItems: 'center', borderRadius: 6 },
  segmentButtonActive: { backgroundColor: '#3a3a3c' },
  segmentLabel: { color: C.white, fontSize: 13, fontWeight: '500' },
  segmentLabelActive: { color: C.white, fontWeight: '600' },
  tabBar: { position: 'absolute', bottom: 0, left: 0, right: 0, borderTopWidth: 0.5, borderTopColor: C.separator },
  tabBarInner: { flexDirection: 'row', paddingTop: 10, paddingBottom: Platform.OS === 'ios' ? 4 : 10 },
  tabItem: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 4 },
  tabIcon: { fontSize: 20, color: C.gray, marginBottom: 4 },
  tabIconActive: { color: C.green },
  tabLabel: { fontSize: 10, fontWeight: '500', color: C.gray, letterSpacing: 0.2 },
  tabLabelActive: { color: C.green },
  callOverlayRoot: { flex: 1, width: SCREEN_WIDTH, height: SCREEN_HEIGHT, backgroundColor: '#000', justifyContent: 'space-between' },
  callTopSection: { flex: 1, paddingTop: Platform.OS === 'ios' ? 80 : 60 },
  callNumberLabel: { color: '#ffffff', fontSize: 42, fontWeight: '400', letterSpacing: -0.5, textAlign: 'center', marginBottom: 8 },
  callSubLabel: { color: 'rgba(255, 255, 255, 0.6)', fontSize: 18, fontWeight: '400', textAlign: 'center' },
  callBottomSection: { paddingBottom: Platform.OS === 'ios' ? 40 : 28 },
  callActionRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 48, alignItems: 'center', marginBottom: 20 },
  callActionItem: { alignItems: 'center' },
  callDeclineButton: { width: 76, height: 76, borderRadius: 38, backgroundColor: '#FF3B30', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  callAnswerButton: { width: 76, height: 76, borderRadius: 38, backgroundColor: '#34C759', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  callButtonLabel: { color: '#ffffff', fontSize: 15, fontWeight: '400', letterSpacing: 0.1 },
  callActionBtn: { width: 70, height: 70, borderRadius: 35, backgroundColor: '#333', alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  callActionActive: { backgroundColor: '#fff' },
});