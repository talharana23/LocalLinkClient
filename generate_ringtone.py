import wave
import struct
import math
import os

# Ensure assets directory exists
os.makedirs('assets', exist_ok=True)

# Parameters
sample_rate = 44100
duration_on = 2.0  # seconds
duration_off = 4.0 # seconds
freq1 = 440.0
freq2 = 480.0
volume = 32767.0 * 0.5

num_samples_on = int(sample_rate * duration_on)
num_samples_off = int(sample_rate * duration_off)

print("Generating ringtone...")

# Open WAV file
with wave.open('assets/ringtone.wav', 'w') as wav_file:
    wav_file.setnchannels(1) # Mono
    wav_file.setsampwidth(2) # 16-bit
    wav_file.setframerate(sample_rate)

    # We will generate 3 cycles of ringing
    for cycle in range(3):
        # Ring ON
        for i in range(num_samples_on):
            t = float(i) / sample_rate
            # Mix two frequencies to sound like a standard phone ring
            value = (math.sin(2.0 * math.pi * freq1 * t) + math.sin(2.0 * math.pi * freq2 * t)) / 2.0
            data = struct.pack('<h', int(value * volume))
            wav_file.writeframesraw(data)

        # Ring OFF
        for i in range(num_samples_off):
            data = struct.pack('<h', 0)
            wav_file.writeframesraw(data)

    wav_file.close()

print("assets/ringtone.wav created successfully!")
