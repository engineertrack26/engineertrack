# Staj Günüm — kurulum ve kabul kontrolü

Bu modül yeni ve bağımsızdır. Eski `daily_logs`, XP/rozet, görev değerlendirme,
Akış ve mesajlaşma tablolarını değiştirmez. Canlı veritabanına otomatik uygulanmaz.

## Kurulum

1. Önce test projesinde uygulayın; üretimde güncel yedek olduğundan emin olun.
2. Mevcut grup, görev/yayın taslakları ve yetkinlik migration'ları kurulmuş olmalıdır:
   `internship_groups`, `group_memberships`, `group_assignments.published_at`,
   `kpi_triplets`, `competency_kpis`, `competencies` ve öğrenci profilleri gereklidir.
3. Supabase SQL Editor'de `docs/internship-days-migration.sql` dosyasını bütünüyle çalıştırın.
   İşlem bir transaction'dır. Yeni tablolar, RPC'ler ve özel `internship-day-files`
   bucket'ı eklenir. Migration bu sürüm için yeniden uygulanabilir.
4. `docs/internship-days-verification.sql` üç parçadır, her biri ayrı gönderilir: Part A yapı
   (tek satır PASS), Part B RPC davranışı (12 vaka, BEGIN..ROLLBACK), Part C `authenticated`
   rolü altında gerçek yetki/politika testi (6 vaka). Hiçbir satır FAIL/ABORTED ile başlamamalı.
   Storage'da önceden tanımlanmış geniş kapsamlı politikalar da incelenmelidir:
   PostgreSQL izin veren politikaları OR ile birleştirir. Sadece yeni politikaların
   doğru olması, mevcut bir genel okuma politikasının oluşturduğu erişimi kapatmaz.
5. Expo Go'yu yenileyin. Üç rolün ana sayfasında Staj Günüm / Katılım ve Günlükler
   kartı görünür. Yeni alt sekme eklenmez. Kurulum yoksa açıklayıcı hata gösterilir.

## İlk sürümün kuralları

- Öğrenci, bir aktif gruba ve işyerindeki mentor rolüne bağlı olmalı; işyeri adı
  ve geçerli başlangıç/bitiş tarihleri bulunmalı. Eksikse yeni gün oluşturulmaz.
- İşyeri/grup/mentor/tarih aralığı ilk kayıtta placement olarak saklanır.
  Saat dilimi ilk kayıt sırasında cihaz takviminden alınır ve o placement için sabitlenir.
  Sunucu tarihi, bu saat dilimiyle doğrular; istemci saati kanıt kabul edilmez.
- Öğrenci başına tarihte tek kayıt vardır. Tekrar istek ilk kaydı döndürür;
  aynı günün saati yeniden yazılmaz. Gelecek veya staj dışı gün oluşturulamaz.
- Geçmiş gün bildirimi ve mentorun sonradan oluşturduğu gün gerekçelidir.
  Bunlarda gerçek zamanlı giriş damgası üretilmez.
- Katılım ile günlük ayrı durum alanlarıdır. İzinli/katılmadı/kararsız günler,
  sırf günlük bulunmadığı için eksik günlük sayılmaz. Tam/kısmi gün ayrı sayılır;
  kısmi günü otomatik 0,5 gün sayma veya çalışma saati hesabı yapılmaz.
- Hafta Pazartesi–Pazar'dır; hafta sonu devamsızlığı varsayılmaz. Advisor raporunda
  "beklenen iş günü" placement tarihleri arasındaki Pzt–Cum günleridir (resmî tatil
  takvimi yok); "şimdiye kadar" bugünde durur. Kayıtsız gün *bilinmeyen*dir, devamsızlık
  değildir — rapor bunu açıkça yazar. Otomatik devamsızlık kararı yoktur.
- Mentor seçtiği günlere toplu karar verir; önceden seçim yapılmaz. Tek bir gün
  yetkisiz/eski sürümse toplu işlem tamamen geri alınır. Önceki kararı değiştirme,
  advisor düzeltme talebini kapatma ve Katıldı dışındaki kararlar gerekçelidir.
- Advisor katılım kararı vermez; geri bildirim veya gerekçeli düzeltme talebi ekler.
  Düzeltme talebi mevcut kararı silmez, ayrı bayrak olarak görünür. Mentor yeni
  gerekçeli kararla bayrağı kapatır; geçmiş talep ve kararlar korunur.
- Taslak günlük yalnızca öğrenciye görünür. Mentor/advisor gönderilmiş günlüğü
  görür. Günlük gönderimi katılımı onaylamaz. Gönderilmiş günlük taslağa dönmez;
  gerekçeli revizyon yapılabilir. İçerik sürümleri işlem geçmişinde saklanır.
- Özdeğerlendirme günün bütünü içindir: gözlem / yoğun destek / kısmi destek /
  bağımsız. Resmî yetkinlik düzeyi veya XP değildir. Öğrenci isterse bir yayımlanmış
  görevi bağlar; görev ve yetkinlik adı o anki hâliyle kopyalanır. Görev seçmek şart değildir.
- Bir isteğe bağlı görsel (JPG/PNG/WebP) veya PDF, en fazla 10 MiB. Yükleme tek
  başına günlük kaydetmez; ilişki Kaydet/Gönder ile kurulur. Ek bağlantıları 5 dakika
  geçerlidir. Öğrenci kendi eklerini, yetkili mentor/advisor yalnızca gönderilmiş
  günlüğün mevcut ekini açabilir. Eski ekler otomatik silinmez.
- Eki günlükten kaldırmak dosyanın depodan silinmesi değildir. İptal edilmiş
  yüklemeler özel depoda sahipsiz kalabilir. Saklama/silme politikası belirlenip
  geçmişte referanslı dosyaları koruyan yönetici temizliği ayrıca kurulmalıdır.
- Mentor erişimi aktif ilişkiyle sınırlıdır: ilişki değişince, grup arşivlenince veya
  üyelik bitince eski mentor erişemez. Yeni mentor, eski mentorun placement kayıtlarına atanmaz.
- Advisor erişimi dönemi aşar: placement'ın grubunun sahibi olan advisor, grup arşivlendikten
  ya da öğrenci gruptan ayrıldıktan sonra da kayıtları **okur** (üniversite raporu dönem
  bittikten sonra yazılır); arşivden sonra geri bildirim veya düzeltme talebi yazamaz.
  Öğrencinin kendi geçmişi her durumda kalır.
- Advisor Raporlar ekranında "Katılım" sekmesi ve CSV'de iki bölüm vardır (öğrenci başına
  toplamlar; gün başına karar, karar veren, check-in, günlük durumu). Kaynak
  `internship_group_attendance(p_group_id)`; günlük içeriği rapora girmez. Modül kurulu
  değilse rapor katılımsız çalışır.
- İnternet gerekir. Başarısız kayıt sırasında form ekranda korunur; uygulama kapanınca
  gönderilmemiş metin için kalıcı çevrimdışı kuyruk yoktur. Ekrandan çıkarken
  kaydedilmemiş değişiklikler için uyarı vardır.
- Uygulama içi bildirimler RPC'lerin içinde yazılır (`internship_notify`): günlük gönderimi →
  mentor; katılım kararı → öğrenci (seçim başına tek bildirim); düzeltme talebi → mentor;
  geri bildirim → öğrenci; düzeltme talebinin kapanması → advisor. Hepsi ilgili rolün
  Staj Günüm ekranına yönlenir. Zamanlanmış hatırlatıcı (haftalık "N gün onay bekliyor")
  pg_cron gerektirir ve yapılmamıştır.

## Expo Go kabul testi

### Sadeleştirilmiş öğrenci / mentor akışı

- Öğrenci başlangıçta yalnızca bugünü görür. “Bugün stajdayım” bildirimi sonrası
  “Günlüğümü yaz” açılır. Geçmiş günler ayrı görünümde; görev, dosya ve sonraki adım
  “İsteğe bağlı detaylar” altında bulunur. Bu alanı kapatmak mevcut ekleri silmez.
- Mentor başlangıçta seçili haftanın öğrenci kartlarını görür. Bekleyen katılım veya
  düzeltme sayısı yüksek olanlar önce gelir; sayılar tüm zamanları değil seçili haftayı
  kapsar. Önceki haftalar hafta gezintisiyle açılır. Öğrenci seçildiğinde yalnızca
  bekleyen/düzeltilecek günler gösterilir; “Haftanın tüm günleri” geçmiş kararları
  ve kaydı olmayan günleri de açar. Günler önceden seçilmez.
- Seçim sonrası altta sabit onay ve farklı durum düğmeleri görünür. Gönderilmiş
  günlük bağımsız okunur; taslak günlük katılım onayını engellemez. İşlem geçmişi
  öğrenci/mentor detayında açılır-kapanır. Advisor akışı ve SQL sözleşmesi korunur.

Bugün/geçmiş geçişini, hafta değişince seçimin temizlenmesini, onaylanan günün
bekleyenlerden çıkmasını ve düzeltme talebiyle yeniden görünmesini kontrol edin.

1. Bağlı öğrenci ile bugünü oluşturun. Katılım Bekliyor, günlük Taslak olmalı.
2. Taslak metin kaydedin. Mentor/advisor metni ve eki görememeli.
3. Özdeğerlendirme dahil günlüğü gönderin. İlgili mentor/advisor metni görebilmeli;
   başka mentor/öğrenci görememeli. Akış'ta paylaşım oluşmamalı.
4. Mentor birkaç günü seçerek Katıldı onaylasın. Günlüğü eksik günün katılımı da
   onaylanabilmeli; kısmi katılım ayrı sayılmalı.
5. Advisor gerekçeli düzeltme istesin. Mentor gerekçeli yeni kararla kapatsın.
   Öğrenci işlem geçmişinde aktör, zaman ve önceki/yeni kararı görmeli.
6. İki cihazda aynı günü açın. Birinde kaydedip diğerinde eski sürümü gönderin.
   İkinci işlem önceki kaydı ezmeden çakışma göstermeli.
7. PDF/görsel ekleyin, kaydedip diğer yetkili rolden açın. Yetkisiz kullanıcıya
   dosya açılamamalı; doğrudan public URL çalışmamalı.
8. Geçmiş gün, izin, kısmi katılım, bağlantı kesintisi, eksik profil ve mentor
   bağlantısı değişikliği senaryolarını deneyin. Büyük font ve dar ekranı kontrol edin.

## Otomatik doğrulama

- `node node_modules/typescript/bin/tsc --noEmit`
- `node node_modules/jest/bin/jest.js --runInBand`
- `node scripts/test-internship-days.cjs <PGlite paketinin mutlak dizini>`

SQL testi geçici bellek içi PostgreSQL'de, sahte mevcut şema/kişiler ile çalışır;
gerçek kullanıcı veya Supabase anahtarı kullanmaz. Üretimdeki diğer RLS politikaları,
Storage HTTP davranışı ve gerçek cihaz kabul testinin yerine geçmez.
