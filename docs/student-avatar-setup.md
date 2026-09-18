# Öğrenci avatarları — kayıt ve profil

## Kurulum

Supabase SQL Editor'de `docs/student-avatar-migration.sql` dosyasının tamamını
bir kez çalıştırın. Ardından `docs/student-avatar-verification.sql` ile yetkileri
kontrol edin. Migration tekrar çalıştırılabilir; mevcut seçimleri değiştirmez.
Önkoşul: mevcut `profiles`, `student_profiles`, `auth.users` ve `calculate_level(integer)`.

SQL bu geliştirme sırasında canlı sunucuda çalıştırılmadı. Önce migration, sonra
yeni kayıt/profil testi yapılmalıdır. Eksik migration profilde açık hata gösterir.

## Davranış

- Öğrenci kayıt formunda isteğe bağlı dokuz karakter seçimi vardır. Atlanabilir.
- E-posta onayı gereken kayıtta da seçim metadata üzerinden profil oluşturulurken
  ayrı bir AFTER INSERT trigger ile kaydedilir. Mevcut `handle_new_user` ve onay
  metni/consent trigger'ları değiştirilmez.
- Kayıt sırasında seçilen karakter `student_avatar_preferences` tablosunda tutulur.
- Profilde seçim/değişiklik, önizleme, kaydetme, hata ve tekrar deneme bulunur.
- Seviye sunucuda mevcut toplam XP'den `calculate_level` ile türetilir.
  İstemci yalnızca avatar kimliği gönderir; hedef kullanıcı veya seviye gönderemez.
- 1–4, 5–9, 10 için üç ana görünüm; 1–10 küçük çerçeve işaretleri.
- Önizlemede ileri aşamalar görülebilir; bunlar kazanılmış görünüm olarak kaydedilmez.
- Hesap değişimi/geciken cevap eski hesabın ekranını güncellemez.
- Mevcut öğrenci fotoğrafları silinmez; öğrenci profilinde avatar seçimi kullanılır.
  Mentör ve advisor profil fotoğrafı yükleme akışı korunur.
- Bu sürüm kayıt ve kendi profilini kapsar. Mesajlar, akış, sıralama ve diğer
  kullanıcı kartlarına avatar dağıtımı henüz yapılmadı; mevcut erişim kuralları
  dikkate alınarak ayrı aşamada bağlanmalıdır. Yeni tablo geniş okuma izni vermez.

## Görseller

`node scripts/optimize-student-avatars.cjs` PNG kaynakları koruyarak 512×512 WebP
kopyaları oluşturur. Uygulama sadece `assets/avatars/mobile` altındaki 27 dosyayı
statik require ile kullanır (yaklaşık 0,77 MB). Kaynak PNG'ler yaklaşık 53 MB'dır.
Yeni native paket, fotoğraf yükleme veya kamera izni gerekmez.

## Expo Go kabul testi

1. Öğrenci kayıt ekranında seç → iptal et: kayıtlı seçim değişmemeli.
2. Seç → kaydet → hesap oluştur → e-posta onayı/giriş → profilde aynı karakter.
3. Seçimi atla: profil seçim daveti göstermeli, başka kullanıcıya ait avatar değil.
4. Profilde değiştir → kaydet → çık/gir: seçim korunmalı, XP aynı kalmalı.
5. 4/5 ve 9/10 sınırlarında görünüm doğru değişmeli; preview kaydetme seviyeyi değiştirmemeli.
6. Bağlantıyı kesip kaydet: hata ve seçim korunmalı; başarı mesajı çıkmamalı.
7. Mentör/advisor: mevcut fotoğraf ve hesap düzenleme davranışı aynı kalmalı.
8. Küçük ekran ve büyük yazıda seçimler taşmamalı; ekran okuyucu seçili seçeneği bildirmeli.

İzole SQL testi: `node scripts/test-student-avatar.cjs <PGlite-paket-yolu>`.
Canlı Supabase ve Expo Go üzerinde bu kabul testi henüz yapılmadı.
