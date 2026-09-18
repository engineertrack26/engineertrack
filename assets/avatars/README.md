# Öğrenci avatarları — görsel seti

Durum: 9 karakter × 3 ana görünüm üretildi. Kayıt ve profil seçimi uygulandı;
canlı kullanım için [SQL kurulumunu](../../docs/student-avatar-setup.md) tamamlamak gerekiyor.

Yerleşik image_gen kullanıldı; her görsel ayrı üretildi. Kesin istemler ve kaynak yolları
[generation-manifest.json](generation-manifest.json) içinde. Yerel kopyalar bu klasördedir.

- 1–4. aşama: `-1` görünümü.
- 5–9. aşama: `-5` görünümü.
- 10. aşama: `-10` görünümü.
- Karakter kimliği `01`–`09`; alan/meslek veya yetkinlik ataması değildir.
- XP, yetkinlik, rozet ve kullanıcı kayıtlarına bu adımda dokunulmadı.
- `02-5-v2.png` düzeltilmiş finaldir. `02-5.png` kullanılmayan ilk denemedir; katalog ona referans vermez.

## Görseller

| Karakter | Başlangıç | İlerleme | Yeni Ufuklar |
| --- | --- | --- | --- |
| 01 | [Aç](01-1.png) | [Aç](01-5.png) | [Aç](01-10.png) |
| 02 | [Aç](02-1.png) | [Aç](02-5-v2.png) | [Aç](02-10.png) |
| 03 | [Aç](03-1.png) | [Aç](03-5.png) | [Aç](03-10.png) |
| 04 | [Aç](04-1.png) | [Aç](04-5.png) | [Aç](04-10.png) |
| 05 | [Aç](05-1.png) | [Aç](05-5.png) | [Aç](05-10.png) |
| 06 | [Aç](06-1.png) | [Aç](06-5.png) | [Aç](06-10.png) |
| 07 | [Aç](07-1.png) | [Aç](07-5.png) | [Aç](07-10.png) |
| 08 | [Aç](08-1.png) | [Aç](08-5.png) | [Aç](08-10.png) |
| 09 | [Aç](09-1.png) | [Aç](09-5.png) | [Aç](09-10.png) |

## Entegrasyon durumu

1. `mobile/` altında 27 adet 512×512 WebP hazır (766.028 bayt). Uygulama yalnızca bunları kullanır; PNG kaynaklar korunur.
2. Seçimi güvenli kaydetme ve kayıt sırasında aktarma migration/RPC'leri hazır; canlı SQL çalıştırılmadı.
3. Öğrenci profilinde avatar seçimi hazır; diğer rollerin fotoğraf akışı korundu.
4. XP aşamasından görünüm seçimi ve 10 küçük aşama işareti eklendi.
5. Mesaj/akış/sıralama gibi diğer alanlara dağıtım ve Expo Go kabul testi sıradaki işlerdir.

Bu set tekil olarak görsel kontrol edildi; Expo Go ekran kontrolü henüz yapılmadı.
