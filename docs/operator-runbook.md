# Operator Runbook — WhatsApp Teacher Assistant

**For:** School coordinator / front-desk staff  
**Purpose:** Day-to-day operation, troubleshooting, and escalation for the WhatsApp messaging system.

---

## Daily Health Check (5 minutes each morning)

1. Open a browser and visit `http://<server-address>:3000/healthz`.
2. Confirm the page shows: `{"ok":true,"db":"ok","evolution":"ok"}`
3. If any value is not `ok`, go to **Section 2 — Restarting the System**.

---

## 1. Roster Upload

**Who does it:** School coordinator.  
**How often:** At the start of each term, and whenever the class list changes (new students, updated phone numbers, or changed class assignments).

**Steps:**

1. Prepare the roster CSV file following the school's standard format.
2. Use the upload tool provided by the technical team, or send the file to the technical team to upload on your behalf.
3. Confirm the success message shows the expected number of students and guardians.

**If the upload fails:**

1. Read the error message — it will name the row with the problem (e.g., "Row 5: phone number is missing").
2. Open the CSV file, fix that row, and upload again.
3. If the error is unclear or repeats, contact the technical team (see **Section 7 — Contacts & Escalation**).

---

## 2. Restarting the System

Use this when the system is unresponsive or the daily health check fails.

On the server machine, open a terminal and run these two commands in order:

```
docker compose down
docker compose up -d
```

Wait 30 seconds, then check `http://<server-address>:3000/healthz` again. If it still shows an error, contact the technical team.

---

## 3. Teacher WhatsApp Disconnected (> 5 Minutes)

Each teacher connects their WhatsApp by scanning a QR code on first setup. This connection can occasionally drop and needs to be refreshed.

**Signs of disconnection:** A teacher reports they stopped receiving replies from guardians, or the system alert shows their connection as "disconnected."

**Steps:**

1. Contact the teacher and let them know you will reconnect their account.
2. Open a browser and go to the teacher's reconnection page.  
   *(The technical team will give you the exact address for each teacher.)*
3. The page shows a QR code. Ask the teacher to:
   - Open WhatsApp on their phone.
   - Tap the three-dot menu → **Linked Devices** → **Link a Device**.
   - Point the phone camera at the QR code on the screen.
4. Wait up to 60 seconds. The connection restores automatically.
5. If the QR code expires before the teacher scans it, refresh the browser page to get a new one.

**If reconnection fails three times in a row:** Stop and contact the technical team.

---

## 4. Teacher's WhatsApp Number Restricted

In rare cases, WhatsApp may restrict a teacher's number. This is a known limitation of how the system works and has been accepted as a risk when setting it up.

**Signs:** The teacher cannot send or receive any WhatsApp messages at all — not just through the bot.

**Steps:**

1. Ask the teacher to stop using the bot immediately.
2. Do **not** attempt to reconnect or restart — it will not help.
3. Contact the technical team right away. They will assess whether to resume on a different number or activate the backup plan.

---

## 5. Database Recovery

> Use this section **only** if the technical team tells you the database is corrupted. This situation is rare and only occurs after an abnormal shutdown such as a power cut.

On the server machine, open a terminal and run the following commands in order:

```
docker compose down
sqlite3 data/whatsapp-bot.sqlite ".recover" | sqlite3 data/whatsapp-bot-recovered.sqlite
mv data/whatsapp-bot.sqlite data/whatsapp-bot.sqlite.bak
mv data/whatsapp-bot-recovered.sqlite data/whatsapp-bot.sqlite
docker compose up -d
```

After the system restarts, check `http://<server-address>:3000/healthz` and confirm `"db":"ok"`. Then call the technical team so they can review the recovered data.

---

## 6. Backups

The system saves a copy of all data automatically every day to the `backups/` folder on the server. If data appears missing or wrong, the technical team can restore from the most recent backup. No manual action is needed to create backups.

---

## 7. Contacts & Escalation

Call the technical team for any issue not resolved by this runbook, including:

- System will not start after a restart.
- Teacher QR code fails three times in a row.
- Teacher's WhatsApp number appears restricted (urgent).
- Data appears missing, wrong, or out of date.
- A new teacher needs to be added to the system.

| | |
|---|---|
| **Name** | _______________________________ |
| **Phone / WhatsApp** | _______________________________ |
| **Email** | _______________________________ |
| **Available hours** | _______________________________ |

> *Fill in the fields above before distributing this document.*

---

*Last updated: 2026-05-31*
