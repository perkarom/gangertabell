# 👑 Gångerkungen

Ett roligt sätt för barn att träna **multiplikationstabellerna 1–10**. Gångerkungen är en webbapp som man installerar på mobilen och som fungerar utan internet.

**▶️ Öppna appen: https://perkarom.github.io/gangertabell/**

![Skärmbilder: startsidan, en fråga och statistiken](docs/skarmbilder.png)

## Så tränar man

Alla förklaringar finns också inne i appen under **❓ Så funkar det** på startsidan. Under **Min statistik** finns ett **?** som förklarar färgerna.


| Läge | Vad händer |
|---|---|
| 🎯 **Välj tabell** | Öva på en eller flera tabeller, t.ex. bara 7:an, eller 6:an och 8:an. |
| 🎲 **Blandat 1–10** | 20 frågor från hela gångertabellen. |
| ⏱️ **Tidsutmaning** | Så många rätt som möjligt på 60 sekunder. Försök slå ditt rekord! |
| 💪 **Öva svåra tal** | Tal du ofta svarar fel på eller tänker länge på kommer oftare. |
| 📊 **Min statistik** | Hela tabellen i färg: grönt = kan, gult = nästan, rött = svår. Dessutom **📅 dag för dag**: staplar för de senaste 14 dagarna med rätt och fel svar, övad tid och dagar med nått mål. |

**👑 Tabeller man redan kan:** när alla 10 tal i en tabell är gröna får den en krona i Välj tabell och ger inga poäng (dagens mål, dagar i rad, stjärnor). Väljer barnet en sådan tabell kommer en pop-up som föreslår en svårare. Blandat, svåra tal och tidsutmaningen räknas som vanligt.

**Spelare:** första gången får man skriva sitt namn och välja ett djur. Flera barn kan spela på samma telefon. Tryck på namnet på startsidan för att byta spelare eller lägga till en ny. Varje spelare har egen statistik, egna stjärnor och eget rekord.

- Stora sifferknappar direkt på skärmen, så att mobilens tangentbord inte täcker frågan.
- Svarar man fel visas rätt svar, och samma fråga kommer tillbaka lite senare i omgången.
- 1–3 stjärnor per omgång, konfetti vid perfekt resultat och nytt rekord.
- Ljud kan slås av och på, och appen följer mobilens mörka läge.

## Dagens mål

Varje spelare kan ha ett mål per dag, som man ändrar med ✏️ under **Vem spelar?**:

- **Rätt svar:** 20, 30, 50, 75 eller 100 rätt svar per dag. Det är förvalt med 30.
- **Minuter:** 5, 10, 15, 20 eller 30 minuters övning per dag. Tiden räknas ner medan man övar, och högst 30 sekunder räknas per fråga, så det hjälper inte att lämna appen öppen.
- **Av**

**🔥 Dagar i rad:** varje dag då målet nås räknas. Utan mål räcker det med ett rätt svar under dagen. Sviten visas på startsidan och finns kvar hela dagen tills målet är nått, och den bästa sviten sparas i statistiken.

Framstegen syns på startsidan och överst när man övar. Rätt svar i alla lägen räknas. När målet är nått blir det konfetti, och vid midnatt börjar räkningen om.

## Installera på mobilen

**Android (Chrome)**
1. Öppna länken ovan i **Chrome**.
2. Tryck på **Installera appen** på startsidan, eller **⋮ → Installera app**.

**iPhone/iPad (Safari eller Chrome)**
1. Öppna länken i **Safari** eller **Chrome**. Chrome kräver iOS/iPadOS 16.4 eller senare.
2. Tryck på **Dela** ⬆︎ och välj **Lägg till på hemskärmen**. I Chrome sitter Dela uppe till höger i adressfältet.

Installationen startar aldrig av sig själv på iPhone och iPad, eftersom Apple bara tillåter det via Dela-menyn.

Appen hamnar på hemskärmen som **6×7**, startar i helskärm och fungerar utan internet. Uppdateringar hämtas automatiskt när appen öppnas med internet. Längst ner på startsidan står **✓ Appen är uppdaterad**, **Utan internet** eller **🔄 Ny version finns**. Kommer en ny version mitt i en övning byts den när övningen är klar. Efter en uppdatering med något nytt för barnet visas en gång rutan **🎉 Nytt i Gångerkungen!** (för varje spelare).

> På iPhone hörs inget ljud om ringknappen på sidan står på ljudlöst.

## Så fungerar "Öva svåra tal"

Varje tal får en vikt utifrån de **5 senaste svaren** på just det talet:

- grundvikt 1, **+3 per fel**, **−0,4 per rätt**, **+2** om man i snitt svarar långsammare än 6 sekunder
- tal man aldrig övat på får vikt 2, och lägsta vikten är 0,3

Svar från **alla lägen** räknas, och **7×8 och 8×7 räknas som samma tal**. Svarar man rätt 5 gånger i rad på ett tal kommer det sällan igen. Ett nytt fel gör att det kommer oftare igen.

## Spara och hämta statistik

Under **Min statistik** finns **💾 Spara statistik** och **📥 Hämta statistik**. Spara skapar en liten fil för spelaren som är vald (`gangerkungen-namn-ÅÅÅÅ-MM-DD.json`) som du kan lägga i Filer, Google Drive eller skicka till dig själv. Hämta läser in filen och ersätter statistiken för spelaren som är vald.

Spara statistiken innan du tar bort appen eller byter telefon. På iPhone raderas statistiken när appen tas bort från hemskärmen.

## Integritet

All statistik sparas bara på enheten (`localStorage`), och en sparad statistikfil hamnar där du själv väljer. Appen skickar ingen data någonstans och har inga konton, ingen reklam och ingen spårning.

## Teknik

Vanlig HTML, CSS och JavaScript. Inga ramverk och inget byggsteg.

| Fil | Innehåll |
|---|---|
| `index.html` | Alla vyer (start, välj tabell, övning, resultat, statistik) |
| `style.css` | Utseende, ljust och mörkt läge |
| `app.js` | Spellogik, statistik, ljud (Web Audio) och installationsknapp |
| `sw.js` | Service worker: hämtar från nätet först och använder cachen när man är offline |
| `manifest.webmanifest` | Appnamn, ikoner och helskärmsläge |
| `icons/` | Appikoner (vanlig, maskable och iOS) |

### Köra lokalt

```bash
python3 -m http.server 8080
# öppna http://localhost:8080
```

### Testa logiken

Funktionerna som skapar frågor och räknar statistik kan köras direkt i Node:

```bash
node -e 'const L = require("./app.js"); console.log(L.buildRound(L.combos([7])))'
```

### Publicera en ny version

Appen publiceras med GitHub Pages från grenen `main`. Höj versionen i `CACHE` i `sw.js` och `APP_VERSION` i `app.js` när du ändrar något, och pusha. Finns det något nytt som barnet märker, lägg till en rad i `NEWS` i `app.js` så visas den i nyhetsrutan. Längst ner på startsidan står om appen är uppdaterad (den jämför `CACHE` i `sw.js` på nätet med `APP_VERSION`). Då hämtar installerade appar den nya versionen nästa gång de öppnas med internet.
