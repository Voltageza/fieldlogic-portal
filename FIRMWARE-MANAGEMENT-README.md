# FieldLink Fleet Firmware Management System

**Version:** 2.0.0
**Last Updated:** 2026-01-18

## 🎯 Overview

A scalable, cloud-based firmware management system designed for managing multiple hardware types across your IoT fleet. The system supports:

- ✅ Multiple hardware types with unique firmwares
- ✅ Device-specific targeted updates
- ✅ Remote firmware delivery via MQTT
- ✅ Firmware versioning and tracking
- ✅ Update status monitoring
- ✅ Portable architecture (Supabase → Dedicated Server)

---

## 🏗️ System Architecture

```
┌──────────────────────────────────────────────────────┐
│             Cloud Dashboard (Web)                     │
│  - Upload firmware files (.bin)                      │
│  - Select devices to update                          │
│  - Monitor update progress                           │
│  - Track firmware versions                           │
└────────────────┬─────────────────────────────────────┘
                 │
    ┌────────────┴────────────┐
    │                         │
┌───▼────────┐      ┌─────────▼────────┐
│  Storage   │      │   PostgreSQL     │
│  (.bin)    │      │   - hardware_types│
│            │      │   - devices      │
│  Supabase  │      │   - firmware_rel │
│  Storage   │      │   - updates      │
│  or S3/CDN │      └──────────┬────────┘
└────────────┘                 │
                    ┌──────────▼──────────┐
                    │   MQTT Broker       │
                    │   (HiveMQ Cloud)    │
                    └──────────┬──────────┘
                               │
        ┌──────────────────────┼──────────────────────┐
        │                      │                      │
   ┌────▼────┐           ┌─────▼────┐          ┌─────▼────┐
   │ Pump    │           │ Motor    │          │ Sensor   │
   │ FL-001  │           │ FL-002   │          │ FL-003   │
   │ v2.0.0  │           │ v1.5.0   │          │ v1.2.0   │
   │ PUMP    │           │ MOTOR    │          │ SENSOR   │
   │ ESP32S3 │           │ ESP32    │          │ ESP8266  │
   └─────────┘           └──────────┘          └──────────┘
```

---

## 📊 Database Schema

### Tables

#### 1. `hardware_types`
Defines different hardware platforms
```sql
- id (UUID)
- type_code (VARCHAR) e.g., 'PUMP_ESP32S3', 'MOTOR_ESP32'
- name (VARCHAR)
- description (TEXT)
```

#### 2. `devices`
Tracks all connected devices
```sql
- device_id (VARCHAR) e.g., 'FL-AABBCC'
- hardware_type_id (UUID)
- firmware_version (VARCHAR)
- name (VARCHAR)
- location (VARCHAR)
- status (VARCHAR) - online/offline/updating
- last_seen (TIMESTAMPTZ)
- ip_address (INET)
```

#### 3. `firmware_releases`
Stores available firmware versions
```sql
- id (UUID)
- hardware_type_id (UUID)
- version (VARCHAR) e.g., '2.0.0'
- file_url (TEXT) - Public URL to .bin file
- file_size (INTEGER)
- checksum (VARCHAR) - SHA-256
- changelog (TEXT)
- is_critical (BOOLEAN)
- is_active (BOOLEAN)
```

#### 4. `firmware_updates`
Tracks update progress
```sql
- id (UUID)
- device_id (VARCHAR)
- firmware_release_id (UUID)
- from_version (VARCHAR)
- to_version (VARCHAR)
- status (VARCHAR) - pending/downloading/installing/success/failed
- progress (INTEGER) 0-100%
- error_message (TEXT)
- started_at (TIMESTAMPTZ)
- completed_at (TIMESTAMPTZ)
```

---

## 🔧 ESP32 Firmware (v2.0.0)

### New Features

1. **Hardware Type Identification**
   ```cpp
   #define HW_TYPE "PUMP_ESP32S3"
   ```

2. **Telemetry with Hardware Info**
   ```json
   {
     "device_id": "FL-AABBCC",
     "hardware_type": "PUMP_ESP32S3",
     "firmware_version": "2.0.0",
     "state": "RUNNING",
     "Ia": 12.5,
     ...
   }
   ```

3. **Remote Firmware Update Handler**
   - Downloads firmware from URL
   - Shows progress (10% intervals)
   - Verifies download size
   - Automatically restarts on success

4. **MQTT Update Command**
   ```json
   {
     "command": "UPDATE_FIRMWARE",
     "url": "https://yourserver.com/firmware/pump-v2.1.0.bin"
   }
   ```

### MQTT Topics

- **Telemetry:** `fieldlink/{DEVICE_ID}/telemetry`
- **Commands:** `fieldlink/{DEVICE_ID}/command`

---

## 🚀 How to Deploy Firmware Updates

### Step 1: Build Firmware
```bash
cd "Main Code/FieldLink_Main_Code"
python -m platformio run
```

Output: `.pio/build/esp32-s3/firmware.bin`

### Step 2: Upload to Cloud Storage

**Option A: Supabase Storage**
1. Go to Supabase Dashboard → Storage
2. Create bucket: `firmware-releases` (public)
3. Upload `firmware.bin` as `pump/v2.0.0.bin`
4. Copy public URL

**Option B: AWS S3 / CloudFlare R2 / DigitalOcean Spaces**
1. Upload firmware to bucket
2. Set public read permissions
3. Get CDN URL

### Step 3: Register in Database
```sql
INSERT INTO firmware_releases (
  hardware_type_id,
  version,
  file_url,
  file_size,
  checksum,
  changelog
) VALUES (
  (SELECT id FROM hardware_types WHERE type_code = 'PUMP_ESP32S3'),
  '2.0.0',
  'https://yourproject.supabase.co/storage/v1/object/public/firmware-releases/pump/v2.0.0.bin',
  1139589,
  'sha256checksum...',
  '- Added remote firmware updates\n- Improved telemetry'
);
```

### Step 4: Push Update to Device(s)

**Via MQTT:**
```javascript
const mqtt = require('mqtt');
const client = mqtt.connect('mqtts://your-broker.com', {
  username: 'your-user',
  password: 'your-pass'
});

client.publish('fieldlink/FL-AABBCC/command', JSON.stringify({
  command: 'UPDATE_FIRMWARE',
  url: 'https://yourserver.com/firmware/pump/v2.0.0.bin'
}));
```

**Via Cloud Dashboard (Future):**
- Select devices
- Choose firmware version
- Click "Push Update"
- Monitor progress

---

## 📈 Update Flow

```
1. Admin uploads .bin to cloud storage
                ↓
2. Admin registers firmware in database
                ↓
3. Dashboard sends MQTT command to device(s)
                ↓
4. Device receives UPDATE_FIRMWARE command
                ↓
5. Device stops pump (safety)
                ↓
6. Device publishes status: "updating"
                ↓
7. Device downloads firmware from URL
                ↓
8. Device verifies download size
                ↓
9. Device installs firmware
                ↓
10. Device restarts automatically
                ↓
11. Device publishes new version in telemetry
                ↓
12. Dashboard marks update as "success"
```

---

## 🔐 Security Best Practices

1. **HTTPS/TLS Only**
   - Always use HTTPS for firmware URLs
   - Use MQTTS (port 8883) for commands

2. **Firmware Verification**
   - Store SHA-256 checksum in database
   - Verify download integrity (future enhancement)

3. **Access Control**
   - Restrict firmware bucket to authenticated users
   - Use Supabase RLS policies
   - Require authentication for dashboard

4. **Rollback Strategy**
   - Keep previous firmware versions available
   - Add rollback command if update fails
   - Monitor update success rates

---

## 🔄 Migration to Dedicated Server

### When your business grows, migrate easily:

**Step 1: Export Database**
```bash
pg_dump -h supabase-host.supabase.co -U postgres -d postgres > fieldlink-backup.sql
```

**Step 2: Setup New Server**
- Deploy PostgreSQL on dedicated server
- Setup S3/CDN for firmware storage

**Step 3: Import Data**
```bash
psql -h your-dedicated-server.com -U postgres -d fieldlink < fieldlink-backup.sql
```

**Step 4: Migrate Firmware Files**
```bash
# Copy from Supabase Storage to S3
aws s3 sync supabase-bucket s3://your-bucket/firmware/
```

**Step 5: Update file_url in Database**
```sql
UPDATE firmware_releases
SET file_url = REPLACE(file_url, 'supabase.co', 'your-cdn.com');
```

**Step 6: Update Connection Strings**
- Update dashboard config
- No changes needed on ESP32 devices!

---

## 📱 Device Management Best Practices

### Hardware Types Organization

```
PUMP_ESP32S3      → Pump controllers with 8DI/8DO
MOTOR_ESP32       → Motor control units
SENSOR_ESP8266    → Low-cost sensor nodes
VALVE_ESP32C3     → Valve control with BLE
GATEWAY_ESP32S3   → LoRa gateway devices
```

### Versioning Strategy

- **Major.Minor.Patch** (e.g., 2.1.3)
- Major: Breaking changes
- Minor: New features
- Patch: Bug fixes

### Update Scheduling

- **Critical Updates:** Force push immediately
- **Feature Updates:** Schedule during maintenance windows
- **Beta Testing:** Push to test devices first

---

## 🛠️ Troubleshooting

### Update Failed

**Check:**
1. Is firmware URL accessible publicly?
2. Is device online and connected to MQTT?
3. Does device have enough flash space?
4. Check serial monitor for error messages

**Common Errors:**
- `HTTP code: 404` → Wrong URL
- `Not enough space for OTA` → Firmware too large
- `Download incomplete` → Network issue
- `Write error` → Flash memory issue

### Device Not Updating

1. Verify MQTT connection
2. Check command topic is correct
3. Ensure JSON format is valid
4. Check device logs via serial

---

## 📊 Monitoring & Analytics

### Track These Metrics

- Devices online/offline count
- Firmware version distribution
- Update success/failure rates
- Average update duration
- Last seen timestamps

### Database Queries

**Devices per firmware version:**
```sql
SELECT firmware_version, COUNT(*) as device_count
FROM devices
GROUP BY firmware_version
ORDER BY device_count DESC;
```

**Recent update failures:**
```sql
SELECT * FROM firmware_updates
WHERE status = 'failed'
ORDER BY created_at DESC
LIMIT 10;
```

**Devices offline > 24 hours:**
```sql
SELECT device_id, name, last_seen
FROM devices
WHERE last_seen < NOW() - INTERVAL '24 hours'
ORDER BY last_seen ASC;
```

---

## 🎯 Next Steps

1. ✅ Setup Supabase database (run `firmware-management-schema.sql`)
2. ✅ Upload firmware v2.0.0 to all devices
3. ⏳ Create cloud dashboard UI for firmware management
4. ⏳ Add firmware upload form to dashboard
5. ⏳ Build device selection interface
6. ⏳ Add update progress monitoring
7. ⏳ Implement automatic update scheduling

---

## 📞 Support

For issues or questions:
- Check device serial logs (115200 baud)
- Review MQTT broker logs
- Check Supabase database logs
- Monitor network connectivity

---

**Built with FieldLink IoT Platform**
Scalable. Reliable. Future-proof.
