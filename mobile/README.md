# Smith แอปมือถือ (Expo / React Native)

แอปจริงสำหรับ App Store และ Google Play ใช้แทนเว็บแอปบนมือถือ หน้าตาเหมือนเว็บแอป (`public/`) และคุยกับเซิร์ฟเวอร์ตัวเดิมผ่าน `/api/*`

## ทดลองบนเครื่องนี้ (iPhone simulator)

1. รันเซิร์ฟเวอร์ (โฟลเดอร์ `smith-agent`): `npm start` (หรือพอร์ตอื่นสำหรับทดสอบ)
2. ในโฟลเดอร์นี้: `npm install` แล้ว `npx expo run:ios` (ครั้งแรกจะ build แอปเนทีฟ ใช้ Xcode ประมาณ 10 นาที)
3. ครั้งต่อไปแค่ `EXPO_PUBLIC_API_URL=http://localhost:3000 npx expo start --dev-client`

`EXPO_PUBLIC_API_URL` คือที่อยู่เซิร์ฟเวอร์ที่แอปจะเรียก ถ้าไม่ตั้ง แอปจะใช้ `http://localhost:3000`

## ทดสอบ

- `npm test`: ทดสอบตัวช่วยจัดรูปแบบ (ราคา เวลา การ์ดคำตอบ ข้อความแชร์)
- `npm run typecheck`
- ฝั่งเซิร์ฟเวอร์ (ล็อกอิน LINE/Apple การซื้อเครดิต push): `npm test` ในโฟลเดอร์ `smith-agent`

## ก่อนส่ง TestFlight / Play internal testing (งานของเจ้าของบัญชี)

1. **URL เซิร์ฟเวอร์ถาวร** (เช่น `https://app.<โดเมน>`): ใส่แทน `REPLACE-WITH-THE-SERVER-URL` ใน `eas.json`
2. **EAS**: `npx eas-cli@latest login` แล้ว `npx eas-cli@latest init` (จะได้ projectId ใน app.json ซึ่ง push notification ต้องใช้)
3. **Apple Developer**:
   - Bundle ID `com.smithagent.app` เปิด Sign in with Apple และ Push Notifications
   - App Store Connect: สร้างแอป และสินค้าแบบ Consumable 3 ตัว `credit_50` (฿59), `credit_100` (฿119), `credit_250` (฿299)
   - Key สำหรับ Sign in with Apple (ไฟล์ .p8): ตั้ง `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY_FILE` ในเซิร์ฟเวอร์ (ใช้ตอนลบบัญชี)
   - เซิร์ฟเวอร์: `APPLE_BUNDLE_ID=com.smithagent.app`
   - App Store Server Notifications v2: ตั้ง URL เป็น `https://<server>/iap/apple/notify` (แจ้งเตือนเมื่อมีการคืนเงิน)
4. **Google Play**:
   - สร้างแอปแพ็กเกจ `com.smithagent.app` และสินค้าแบบ one-time 3 ตัว (id เดียวกับข้างบน)
   - Service account ที่มีสิทธิ์ใน Play Console: ตั้ง `GOOGLE_PLAY_PACKAGE`, `GOOGLE_SERVICE_ACCOUNT_FILE` ในเซิร์ฟเวอร์
   - Real-time developer notifications (Pub/Sub push) ไปที่ `https://<server>/iap/google/notify`
   - FCM: อัปโหลด google-services / FCM key ให้ EAS (`eas credentials`) เพื่อให้ push ทำงานบน Android
5. **LINE Login channel 2012750284**: เพิ่ม iOS bundle ID `com.smithagent.app` และ Android package + ลายเซ็นของแอปในหน้า channel (LINE SDK ต้องใช้)
6. Build: `npx eas-cli@latest build --profile production --platform all` แล้ว `npx eas-cli@latest submit`

## โครงสร้าง

- `src/app/` หน้าจอ (Expo Router, หนึ่งไฟล์ต่อหนึ่ง route ตามเว็บแอป)
- `src/ui/` ชิ้นส่วนหน้าตา (`kit.tsx`), ช้าง (`Mascot.tsx`), สี (`theme.ts`)
- `src/lib/` เรียกเซิร์ฟเวอร์ (`api.ts`), ล็อกอิน (`auth.ts`), push (`push.ts`), ตั้งค่าในเครื่อง (`prefs.tsx`), ตัวช่วยจัดรูปแบบ (`format.ts`)
- `plugins/with-line.js` ต่อ LINE SDK เข้ากับ Expo SDK 58 (ปลั๊กอินของ LINE SDK ยังไม่รองรับ)
