# FieldLogic Portal

Customer portal for FieldLink IoT pump controllers.

## Setup Instructions

### Step 1: Create Supabase Project (Free)

1. Go to [supabase.com](https://supabase.com) and create an account
2. Click "New Project"
3. Choose a name (e.g., "fieldlogic")
4. Set a database password (save this!)
5. Select region closest to you
6. Wait for project to be created (~2 minutes)

### Step 2: Create Database Tables

1. In Supabase dashboard, go to **SQL Editor**
2. Click **New Query**
3. Copy the contents of `setup.sql` and paste it
4. Click **Run**
5. You should see "Success. No rows returned"

### Step 3: Configure Authentication

1. Go to **Authentication** > **Providers**
2. Email provider should be enabled by default
3. Go to **Authentication** > **URL Configuration**
4. Set Site URL to: `https://fieldlogic.co.za`

### Step 4: Get API Keys

1. Go to **Settings** > **API**
2. Copy the **Project URL** (looks like `https://xxxxx.supabase.co`)
3. Copy the **anon public** key (long string starting with `eyJ...`)

### Step 5: Update config.js

Edit `config.js` and replace:
```javascript
const SUPABASE_URL = 'https://YOUR_PROJECT_ID.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR_ANON_KEY_HERE';
```

With your actual values from Step 4.

### Step 6: Deploy to GitHub Pages

1. Create a new GitHub repository named `fieldlogic-portal`
2. Push all files to the repository
3. Go to Settings > Pages
4. Set Source to "Deploy from a branch"
5. Select "main" branch and "/ (root)"
6. Click Save

### Step 7: Configure Domain at Xneelo

1. Log in to Xneelo control panel
2. Go to DNS Management for fieldlogic.co.za
3. Add these DNS records:

| Type  | Name | Value |
|-------|------|-------|
| A     | @    | 185.199.108.153 |
| A     | @    | 185.199.109.153 |
| A     | @    | 185.199.110.153 |
| A     | @    | 185.199.111.153 |
| CNAME | www  | YOUR_GITHUB_USERNAME.github.io |

4. In GitHub repo Settings > Pages > Custom domain, enter: `fieldlogic.co.za`
5. Check "Enforce HTTPS"

DNS changes can take up to 24 hours to propagate.

## Files

- `index.html` - Main application (SPA)
- `config.js` - Configuration (Supabase + MQTT)
- `setup.sql` - Database schema for Supabase
- `manifest.json` - PWA manifest
- `sw.js` - Service worker for offline support
- `icon-*.png` - App icons

## Features

- Customer self-registration with email verification
- Device registration and management
- Real-time pump monitoring via MQTT
- Remote START/STOP/RESET commands
- PWA - installable on mobile devices
- Works offline (cached resources)
