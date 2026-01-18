-- ================================================================
-- FIELDLINK FIRMWARE MANAGEMENT SYSTEM
-- Portable PostgreSQL schema (works with Supabase or any PostgreSQL)
-- ================================================================

-- ================================================================
-- 1. HARDWARE TYPES TABLE
-- Defines different types of hardware devices
-- ================================================================
CREATE TABLE IF NOT EXISTS hardware_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type_code VARCHAR(50) UNIQUE NOT NULL,  -- e.g., 'PUMP_ESP32S3', 'MOTOR_ESP32', 'SENSOR_ESP8266'
  name VARCHAR(100) NOT NULL,              -- Human-readable name
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- 2. DEVICES TABLE (Enhanced)
-- Track all devices with their hardware type and current firmware
-- ================================================================
CREATE TABLE IF NOT EXISTS devices (
  device_id VARCHAR(20) PRIMARY KEY,       -- e.g., 'FL-AABBCC'
  hardware_type_id UUID REFERENCES hardware_types(id),
  firmware_version VARCHAR(50),            -- Current firmware version
  name VARCHAR(100),                       -- User-friendly name
  location VARCHAR(200),                   -- Physical location
  status VARCHAR(20) DEFAULT 'offline',    -- online, offline, updating
  last_seen TIMESTAMPTZ,
  ip_address INET,
  mac_address MACADDR,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- 3. FIRMWARE RELEASES TABLE
-- Store firmware files for different hardware types
-- ================================================================
CREATE TABLE IF NOT EXISTS firmware_releases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hardware_type_id UUID REFERENCES hardware_types(id) NOT NULL,
  version VARCHAR(50) NOT NULL,            -- e.g., '1.9.1', '2.0.0'
  file_url TEXT NOT NULL,                  -- Public URL to .bin file
  file_size INTEGER,                       -- File size in bytes
  checksum VARCHAR(64),                    -- SHA-256 checksum for verification
  changelog TEXT,                          -- Release notes
  is_critical BOOLEAN DEFAULT FALSE,       -- Force update flag
  is_active BOOLEAN DEFAULT TRUE,          -- Can be deployed
  released_by VARCHAR(100),
  released_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(hardware_type_id, version)
);

-- ================================================================
-- 4. FIRMWARE UPDATES TABLE
-- Track update status for each device
-- ================================================================
CREATE TABLE IF NOT EXISTS firmware_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id VARCHAR(20) REFERENCES devices(device_id),
  firmware_release_id UUID REFERENCES firmware_releases(id),
  from_version VARCHAR(50),
  to_version VARCHAR(50),
  status VARCHAR(20) DEFAULT 'pending',    -- pending, downloading, installing, success, failed
  progress INTEGER DEFAULT 0,              -- 0-100%
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- 5. INDEXES FOR PERFORMANCE
-- ================================================================
CREATE INDEX IF NOT EXISTS idx_devices_hardware_type ON devices(hardware_type_id);
CREATE INDEX IF NOT EXISTS idx_devices_status ON devices(status);
CREATE INDEX IF NOT EXISTS idx_devices_last_seen ON devices(last_seen DESC);
CREATE INDEX IF NOT EXISTS idx_firmware_releases_hardware_type ON firmware_releases(hardware_type_id);
CREATE INDEX IF NOT EXISTS idx_firmware_releases_active ON firmware_releases(is_active);
CREATE INDEX IF NOT EXISTS idx_firmware_updates_device ON firmware_updates(device_id);
CREATE INDEX IF NOT EXISTS idx_firmware_updates_status ON firmware_updates(status);

-- ================================================================
-- 6. ROW-LEVEL SECURITY (for Supabase)
-- ================================================================
ALTER TABLE hardware_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE firmware_releases ENABLE ROW LEVEL SECURITY;
ALTER TABLE firmware_updates ENABLE ROW LEVEL SECURITY;

-- Admin policy (adjust service_role as needed)
CREATE POLICY "Admin full access to hardware_types" ON hardware_types
  FOR ALL USING (true);

CREATE POLICY "Admin full access to devices" ON devices
  FOR ALL USING (true);

CREATE POLICY "Admin full access to firmware_releases" ON firmware_releases
  FOR ALL USING (true);

CREATE POLICY "Admin full access to firmware_updates" ON firmware_updates
  FOR ALL USING (true);

-- ================================================================
-- 7. SAMPLE DATA
-- ================================================================
-- Insert sample hardware types
INSERT INTO hardware_types (type_code, name, description) VALUES
  ('PUMP_ESP32S3', 'ESP32-S3 Pump Controller', 'Waveshare ESP32-S3 with 8DI/8DO for pump control'),
  ('MOTOR_ESP32', 'ESP32 Motor Controller', 'Standard ESP32 with motor driver'),
  ('SENSOR_ESP8266', 'ESP8266 Sensor Node', 'Low-cost sensor monitoring device')
ON CONFLICT (type_code) DO NOTHING;

-- ================================================================
-- 8. FUNCTIONS FOR AUTOMATION
-- ================================================================

-- Function to update device last_seen timestamp
CREATE OR REPLACE FUNCTION update_device_last_seen()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update timestamps
DROP TRIGGER IF EXISTS update_device_timestamp ON devices;
CREATE TRIGGER update_device_timestamp
  BEFORE UPDATE ON devices
  FOR EACH ROW
  EXECUTE FUNCTION update_device_last_seen();

-- ================================================================
-- 9. VIEWS FOR DASHBOARD
-- ================================================================

-- View: Active firmware versions by hardware type
CREATE OR REPLACE VIEW firmware_versions_summary AS
SELECT
  ht.type_code,
  ht.name as hardware_name,
  fr.version,
  fr.released_at,
  COUNT(d.device_id) as device_count
FROM hardware_types ht
LEFT JOIN firmware_releases fr ON fr.hardware_type_id = ht.id
LEFT JOIN devices d ON d.hardware_type_id = ht.id AND d.firmware_version = fr.version
WHERE fr.is_active = true OR fr.id IS NULL
GROUP BY ht.type_code, ht.name, fr.version, fr.released_at
ORDER BY ht.type_code, fr.released_at DESC;

-- View: Pending updates
CREATE OR REPLACE VIEW pending_updates_summary AS
SELECT
  fu.id,
  fu.device_id,
  d.name as device_name,
  ht.name as hardware_type,
  fu.from_version,
  fu.to_version,
  fu.status,
  fu.progress,
  fu.created_at
FROM firmware_updates fu
JOIN devices d ON d.device_id = fu.device_id
JOIN hardware_types ht ON ht.id = d.hardware_type_id
WHERE fu.status NOT IN ('success', 'failed')
ORDER BY fu.created_at DESC;

-- ================================================================
-- MIGRATION NOTES FOR FUTURE DEDICATED SERVER:
-- ================================================================
-- 1. Export data: pg_dump -h supabase-host -U postgres -d postgres > backup.sql
-- 2. Create new PostgreSQL instance on dedicated server
-- 3. Import data: psql -h new-host -U postgres -d postgres < backup.sql
-- 4. Update connection strings in application
-- 5. Migrate storage: Copy firmware files from Supabase Storage to S3/CDN
-- 6. Update file_url in firmware_releases table
-- ================================================================
