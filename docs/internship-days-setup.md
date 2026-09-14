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
4. `docs/internship-days-verification.sql` ile yapı/izinleri kontrol edin.
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
- Hafta Pazartesi–Pazar'dır; hafta sonu devamsızlığı varsayılmaz. Çalışma takvimi
  tanımlı olmadığı için beklenen iş günü/otomatik devamsızlık hesabı yoktur.
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
- Erişim aktif ilişkiyle sınırlandırılmıştır. Eski mentor ilişki değişince erişemez.
  Grup arşivlenince veya üyelik bitince mentor/advisor erişimi kapanır; öğrencinin
  kendi geçmişi kalır. Yeni mentor, eski mentorun placement kayıtlarına atanmaz.
  Uzun süreli kurumsal arşiv erişimi gerekiyorsa ayrı yetkilendirme kararı gerekir.
- İnternet gerekir. Başarısız kayıt sırasında form ekranda korunur; uygulama kapanınca
  gönderilmemiş metin için kalıcı çevrimdışı kuyruk yoktur. Ekrandan çıkarken
  kaydedilmemiş değişiklikler için uyarı vardır. Otomatik bildirim/hatırlatıcı yoktur.

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
