# Work & Bills

A simple website (works on phone and desktop) for:

1. **Work tracking:** employees **Login → send work updates → Logout**. Each step needs a live selfie and their location.
2. **Bills:** employees photograph bills with the camera (no upload option), add the amount and reason, split group bills, and track approval.
3. **Money control:** HR/Admin approve bills and see each person's limit, used and remaining amount. The Super Admin also sees spending charts.

No live tracking. Location is recorded only when someone logs in, sends an update, logs out or adds a bill.

```
fieldforce/
├── server/   Node.js API + database (also serves the website)
└── web/      The website: index.html, app.js, styles.css
```

## Who sees what

| | Employee | HR / Admin | Super Admin |
|---|:-:|:-:|:-:|
| My Day: Login, Work update, Logout (selfie + location) | ✓ | ✓ | |
| My Bills: add bill with camera, group bill split, approval status, own limit/used/remaining | ✓ | ✓ | |
| Approvals: approve / reject (with reason) / undo, see each person's remaining limit | | ✓ | ✓ |
| Attendance: login/logout times, updates, selfies and locations for any day | | ✓ | ✓ |
| Usage: limit, used, waiting and remaining per person per month | | ✓ | ✓ |
| People: add users, set monthly limit, reset password, disable | employees only | | everyone |
| Money dashboard: monthly spend (12 months), daily spend, by person vs limit, by type | | | ✓ |
| Settings: report times, company name | | | ✓ |
| Download bills as Excel (CSV) | | ✓ | ✓ |

### Report times
The Super Admin sets the times when work updates are expected (for example 10:00, 13:00, 16:00, 18:30).
Employees see them on **My Day**, and each one turns green ✓ once an update is sent around that time
(from 30 minutes before). Updates are **not forced**; the times are only a guide. Admins see the same ticks on **Attendance**.

### Group bills (no duplicates)
One person takes the bill photo, turns on **Group bill**, ticks the people who were there, and splits the amount
(equally, or by typing each share). The bill is added **once**. Each person's share counts toward their own monthly
limit, and every member sees it under **My Bills**.
Duplicate protection: if anyone tries to add a bill with the same amount for any of the same people within 3 hours,
they are warned first. If they still submit, the bill is marked **"Possible duplicate"** for the approver.

### Limit, used, waiting, remaining
- **Limit:** monthly bill limit set per person (0 = no limit)
- **Used:** approved bills (their share) this month
- **Waiting:** bills not yet approved
- **Remaining:** Limit − Used − Waiting (shown in red if over)

## Run it

Requires **Node.js 22.13 or newer** (uses the database built into Node, so no extra software is needed).

```bash
cd server
cp .env.example .env      # set JWT_SECRET to a long random text
npm install
npm start
```

Open http://localhost:4000 and sign in as **admin@company.com / Admin@123**. Change this password right away.
Then go to **People** and add HR/Admin and employees (they sign in with their phone number or email).

## Put it online (needed for phones)

Phone browsers only allow the **camera and location on https://** websites.

- **VPS** (Hostinger, DigitalOcean, AWS Lightsail…): install Node 22, run `npm start` with `pm2`, and put nginx + free
  Let's Encrypt SSL in front. In nginx add `client_max_body_size 20M;`.
- **Railway / Render:** deploy the `server` folder, attach a persistent disk, and set `DATA_DIR` to it. The database
  and bill photos are stored there.

Back up the `DATA_DIR` folder (database + `uploads/` photos) every day.

Employees can open the site on their phone and use **Add to Home Screen** so it works like an app.

## Settings (`server/.env`)

| Setting | Default | Meaning |
|---|---|---|
| `PORT` | 4000 | Server port |
| `JWT_SECRET` | — | Long random text (required for security) |
| `SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_PASSWORD` | admin@company.com / Admin@123 | First super admin, created on first start |
| `TZ_OFFSET` / `TZ_DISPLAY` | +05:30 / Asia/Kolkata | Company time zone |
| `DATA_DIR` | server/data | Where the database and photos are kept |

## Good to know
- Every photo is stamped by the server with the name, date/time, GPS location, address and note/reason, so a downloaded photo still shows when and where it was taken.
- There is no file input anywhere. Photos can only come from the live camera, and the server rejects anything else.
- An employee can delete their own bill only while it is still waiting. Approvers must give a reason when rejecting.
- HR/Admin cannot approve their own bills (another admin or the Super Admin must).
- Tell employees in writing that selfies and location are recorded at login, update, logout and bill time (India's DPDP Act 2023).
