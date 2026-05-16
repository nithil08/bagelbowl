# 🥯 Bagel Bowl — Full Deployment Guide
## From this ZIP to a live website in ~20 minutes

---

## PART 1 — Supabase (Your Database)

### Step 1: Create your Supabase project
1. Go to **https://supabase.com** → Sign up (free)
2. Click **"New Project"**
3. Name it: `bagel-bowl`
4. Set a database password (save it somewhere)
5. Choose region: **US East** (or closest to you)
6. Click **"Create new project"** — wait ~2 min

### Step 2: Run the database schema
1. In your Supabase project, click **"SQL Editor"** in the left sidebar
2. Click **"New query"**
3. Open the file `supabase-schema.sql` from this folder
4. Copy the ENTIRE contents and paste into the SQL editor
5. Click **"Run"** (green button)
6. You should see: `Success. No rows returned`

### Step 3: Set up photo storage
1. In Supabase, click **"Storage"** in the left sidebar
2. If you don't see a `party-photos` bucket, click **"New bucket"**
3. Name: `party-photos`
4. Toggle **"Public bucket"** ON
5. Click **"Create bucket"**

### Step 4: Get your API credentials
1. Click **"Project Settings"** (gear icon, bottom left)
2. Click **"API"**
3. Copy two things — you'll need them in Part 3:
   - **Project URL** — looks like `https://abcdefg.supabase.co`
   - **anon public** key — long string starting with `eyJ...`

---

## PART 2 — GitHub (Your Code Home)

### Step 5: Create a GitHub account
- Go to **https://github.com** → Sign up (free) if you don't have one

### Step 6: Create a new repository
1. Click the **"+"** icon (top right) → **"New repository"**
2. Repository name: `bagel-bowl`
3. Set to **Public**
4. Do NOT check "Add README" (the folder already has files)
5. Click **"Create repository"**

### Step 7: Upload the code
**Easiest way — drag and drop in GitHub:**
1. On your new empty repo page, click **"uploading an existing file"**
2. Unzip the bagel-bowl folder on your computer
3. Open the unzipped folder — you should see: `app/`, `lib/`, `package.json`, etc.
4. Drag ALL the files and folders into the GitHub upload window
5. Scroll down → click **"Commit changes"**

**Alternative — using Terminal (if comfortable):**
```bash
cd path/to/bagel-bowl
git init
git add .
git commit -m "Initial bagel bowl commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/bagel-bowl.git
git push -u origin main
```

---

## PART 3 — Vercel (Your Hosting)

### Step 8: Create Vercel account
1. Go to **https://vercel.com** → Sign up
2. Choose **"Continue with GitHub"** — this links them automatically

### Step 9: Import your repository
1. On the Vercel dashboard, click **"Add New Project"**
2. Find `bagel-bowl` in the list → click **"Import"**
3. Framework preset should auto-detect as **Next.js** ✓
4. Don't change anything else yet

### Step 10: Add environment variables (CRITICAL — don't skip)
Before clicking Deploy, scroll down to **"Environment Variables"**:

Add these two variables:
| Name | Value |
|------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase Project URL from Step 4 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Your Supabase anon key from Step 4 |

Click **"Add"** after each one.

### Step 11: Deploy
1. Click **"Deploy"** — takes about 2 minutes
2. When done, you'll see a confetti animation and a URL like:
   `https://bagel-bowl.vercel.app`
3. Click the URL to test it — you should see the spinning bagel 🥯

---

## PART 4 — QR Code

### Step 12: Generate your QR code
1. Go to **https://qr.io** (or any free QR generator)
2. Paste your Vercel URL: `https://bagel-bowl.vercel.app`
3. Download the QR code as PNG
4. Print it — tape copies to every table, the front door, and near the bagel station

---

## PART 5 — Party Day Checklist

### 48 hours before:
- [ ] Deploy and test the full flow on your phone
- [ ] Scan QR code → enter name → check that rating works
- [ ] Visit `/host` and make sure the dashboard loads
- [ ] Upload a test photo to confirm storage works

### Day of party:
- [ ] Open `/host` on a laptop or tablet for the host screen
- [ ] As guests check in on the app, activate their cheeses in the Check-in tab
- [ ] Watch for duplicate cheese names — merge or mark as dupe
- [ ] When 80%+ of ratings are in, close the round from the Bracket tab
- [ ] Repeat for each round until one cheese remains

### If something breaks:
- Supabase status: **https://status.supabase.com**
- Vercel status: **https://www.vercel-status.com**
- Redeploy: Vercel dashboard → your project → "Redeploy"

---

## Edge Cases Already Handled
- ✓ Same device checking in twice → restores session
- ✓ Phone dies mid-flow → session saved, comes back to same state
- ✓ Duplicate cheese names → flagged at check-in
- ✓ No cheese brought → floater role, still gets to rate
- ✓ Solo attendee → floater role
- ✓ Cheese eliminated → pair becomes judge in next round
- ✓ Odd number of cheeses → bye system (highest score advances)
- ✓ Advancing too early → warning shown below 80% submissions
- ✓ Submitting twice → database rejects duplicate (unique constraint)
- ✓ Math-free cheese assignment → load-balanced, unique per device
