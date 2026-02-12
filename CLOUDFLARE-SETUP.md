# הוראות הפעלה - Cloudflare Quick Tunnel

## שלב 1: הפעלת השרת
פתח טרמינל והרץ:
```powershell
cd "C:\Users\nirc\Copilot github\Tenant Manager\server"
node server.js
```

השרת יתחיל לרוץ על http://localhost:3001

## שלב 2: הפעלת Cloudflare Tunnel
פתח טרמינל **נוסף** והרץ:
```powershell
cd "C:\Users\nirc\Copilot github\Tenant Manager"
.\start-tunnel.ps1
```

תראה משהו כזה:
```
+--------------------------------------------------------------------------------------------+
|  Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):  |
|  https://abc-def-123.trycloudflare.com                                                     |
+--------------------------------------------------------------------------------------------+
```

## שלב 3: העתק את ה-URL לאפליקציה
1. **העתק** את ה-URL המלא (לדוגמה: `https://abc-def-123.trycloudflare.com`)
2. פתח את האפליקציה בדפדפן: `index.html`
3. לחץ על **⚙️ הגדרות**
4. **הדבק** את ה-URL בשדה "כתובת שרת (Server URL)"
5. לחץ **שמור**

## שלב 4: גישה מהטלפון
1. פתח את הטלפון
2. פתח דפדפן (Chrome/Safari)
3. הקלד את אותו URL: `https://abc-def-123.trycloudflare.com`
4. האפליקציה תעבוד!

## ⚠️ חשוב לדעת
- **ה-URL משתנה בכל הפעלה מחדש** של start-tunnel.ps1
- כל פעם שמפעילים את המחשב מחדש, צריך:
  1. להפעיל את השרת (`node server.js`)
  2. להפעיל את ה-tunnel (`.\start-tunnel.ps1`)
  3. להעתיק את ה-URL החדש להגדרות
- התהליכים צריכים להישאר פועלים כל הזמן שרוצים גישה מהטלפון
- כשסוגרים את המחשב, ה-tunnel נסגר

## 🔧 פתרון בעיות
- **"Cannot connect"** - בדוק שהשרת וה-tunnel רצים
- **"404 Not Found"** - העתק URL חדש מה-tunnel
- **השרת לא עולה** - סגור תהליכים ישנים: `Get-Process node | Stop-Process`
