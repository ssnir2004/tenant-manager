# הגדרת דומיין קבוע - app.rentflows.work

## דרישות מקדימות
- ✅ הדומיין `rentflows.work` מנוהל ב-Cloudflare
- ✅ יש לך גישה ל-Cloudflare Dashboard
- ✅ `cloudflared.exe` מותקן (כבר יש לך בתיקייה)

---

## שלב 1: יצירת Named Tunnel ב-Cloudflare

### 1.1 התחבר ל-Cloudflare Dashboard
1. עבור ל-https://dash.cloudflare.com
2. בחר את הדומיין **rentflows.work**

### 1.2 צור Tunnel חדש
1. בתפריט השמאלי, לחץ על **Zero Trust** (או **Access**)
2. לחץ על **Networks** → **Tunnels**
3. לחץ על **Create a tunnel**
4. בחר **Cloudflared**
5. תן שם ל-Tunnel: **`rentflows-app`**
6. לחץ **Save tunnel**

### 1.3 התקן את ה-Tunnel
אחרי יצירת הטנל, תקבל פקודת התקנה. **לא צריך להריץ אותה!**  
במקום זה:

1. Cloudflare יציג לך **Tunnel ID** ו-**Tunnel Token**
2. **העתק את ה-Tunnel ID** (מחרוזת ארוכה כמו: `12345678-1234-1234-1234-123456789abc`)

### 1.4 הורד את קובץ ה-Credentials
1. בדף הטנל, לחץ על **Configure**
2. גלול למטה ב-**Connectors** ושם תראה אופציה להוריד credentials
3. לחלופין, הרץ את הפקודה הזו (החלף `YOUR_TUNNEL_ID` ב-ID האמיתי):

```powershell
.\cloudflared.exe tunnel token YOUR_TUNNEL_ID
```

זה ייצור קובץ בנתיב: `C:\Users\nirc\.cloudflared\YOUR_TUNNEL_ID.json`

---

## שלב 2: הגדרת Subdomain

### 2.1 קישור הדומיין לטנל
1. בדף הטנל ב-Cloudflare Dashboard
2. בחר **Public Hostnames**
3. לחץ **Add a public hostname**
4. מלא את הפרטים:
   - **Subdomain**: `app`
   - **Domain**: `rentflows.work`
   - **Path**: השאר ריק
   - **Type**: `HTTP`
   - **URL**: `localhost:3001`
5. לחץ **Save hostname**

---

## שלב 3: עדכון קובץ התצורה המקומי

### 3.1 ערוך את הקובץ `cloudflare-tunnel-config.yml`
1. פתח את הקובץ: `cloudflare-tunnel-config.yml` (כבר נוצר עבורך)
2. החלף את `YOUR_TUNNEL_ID_HERE` ב-**Tunnel ID** האמיתי (בשני המקומות!)
3. שמור את הקובץ

הקובץ אמור להיראות כך:
```yaml
tunnel: 12345678-1234-1234-1234-123456789abc
credentials-file: C:\Users\nirc\.cloudflared\12345678-1234-1234-1234-123456789abc.json

ingress:
  - hostname: app.rentflows.work
    service: http://localhost:3001
  - service: http_status:404
```

---

## שלב 4: הפעלת האפליקציה

### 4.1 צור סקריפט הפעלה חדש
צור קובץ בשם `start-production-tunnel.ps1`:

```powershell
# Start Production Tunnel
Write-Host "Starting Production Tunnel for app.rentflows.work..." -ForegroundColor Cyan

# Check if tunnel config exists
if (-not (Test-Path "cloudflare-tunnel-config.yml")) {
    Write-Host "ERROR: cloudflare-tunnel-config.yml not found!" -ForegroundColor Red
    exit 1
}

# Start tunnel with config
.\cloudflared.exe tunnel --config cloudflare-tunnel-config.yml run

Write-Host "Tunnel stopped" -ForegroundColor Yellow
```

### 4.2 הרץ את האפליקציה
פתח **שני** טרמינלים:

**טרמינל 1 - השרת:**
```powershell
cd "C:\Users\nirc\Copilot github\Tenant Manager\server"
node server.js
```

**טרמינל 2 - הטנל:**
```powershell
cd "C:\Users\nirc\Copilot github\Tenant Manager"
.\start-production-tunnel.ps1
```

אם הכל עובד, תראה בטרמינל:
```
Connection ... registered connID=... tunnel=rentflows-app
```

---

## שלב 5: גישה לאפליקציה

פתח דפדפן וגש ל: **https://app.rentflows.work**

האפליקציה תעבוד אוטומטית עם הדומיין החדש! ✅

---

## מה השתנה מ-Quick Tunnel?

| Quick Tunnel (ישן) | Named Tunnel (חדש) |
|-------------------|-------------------|
| ❌ URL משתנה בכל הפעלה | ✅ URL קבוע: `app.rentflows.work` |
| ❌ צריך לעדכן הגדרות כל פעם | ✅ אף פעם לא צריך לעדכן |
| ❌ לא יציב ל-production | ✅ מתאים ל-production |
| ✅ מהיר להקמה | ⏱️ דורש הגדרה חד-פעמית |

---

## הפעלה אוטומטית בהמשך

### אפשרות 1: הפעלה ידנית (מומלץ בהתחלה)
כל פעם שמדליקים את המחשב:
1. פתח טרמינל → `cd server && node server.js`
2. פתח טרמינל שני → `.\start-production-tunnel.ps1`

### אפשרות 2: הפעלה אוטומטית (מתקדם)
להפוך את שני התהליכים ל-Windows Services עם:
- [NSSM](https://nssm.cc/) לשרת Node.js
- Cloudflare Tunnel כ-service: `cloudflared service install`

---

## פתרון בעיות

### הטנל לא מתחבר
```powershell
# בדוק שה-Tunnel ID תקין
.\cloudflared.exe tunnel info YOUR_TUNNEL_ID

# בדוק שיש credentials
Test-Path "C:\Users\nirc\.cloudflared\YOUR_TUNNEL_ID.json"
```

### השרת לא עונה
```powershell
# בדוק שהשרת רץ על פורט 3001
Get-NetTCPConnection -LocalPort 3001 -State Listen

# בדוק בדפדפן: http://localhost:3001 (צריך לראות את האפליקציה)
```

### "503 Service Unavailable"
- הטנל רץ אבל השרת לא → הפעל `node server.js`

### "Cannot connect" או "DNS resolution error"
- ייתכן שה-DNS לא התעדכן עדיין → המתן 1-2 דקות
- בדוק ב-Cloudflare Dashboard ש-app.rentflows.work מקושר לטנל

---

## סיכום מהיר

✅ קוד האפליקציה **כבר מוכן** לעבוד עם `app.rentflows.work`  
✅ הקובץ `cloudflare-tunnel-config.yml` **כבר נוצר** - רק צריך למלא Tunnel ID  
✅ השרת תומך ב-CORS ומשרת קבצים סטטיים  

**כל מה שנותר:**
1. צור Named Tunnel ב-Cloudflare Dashboard
2. הורד credentials
3. עדכן את `cloudflare-tunnel-config.yml` עם ה-Tunnel ID
4. הרץ `node server.js` ו-`start-production-tunnel.ps1`
5. **פתח https://app.rentflows.work**

🎉 זהו!
