# Oyunlaştırma v2 — yeni başarı kuralları

Güncelleme: Kullanıcının uzun stajlar için kademeli aile kararı sonrasında
`growth-journey-setup.md` uygulanabilir ilk sürümü tanımlar. Aşağıdaki tekil rozet
ve kalıcı ödül tablosu tasarımı bu sürümde devreye alınmamıştır. Yeni aileler
sunucudan doğrulanan, güncel duruma göre hesaplanan başarı aşamalarıdır; kalıcı
rozet kazanma veya geriye dönük XP dağıtımı yapmazlar.

Durum: uygulama öncesi kural tasarımı. Bu belge yeni ödül dağıtmaz; SQL değildir.
İlk aşamadaki katalog temizliği ayrıca uygulanmıştır. Canlı veritabanı sürümü,
migration öncesinde okunur doğrulama sorgularıyla kontrol edilmelidir.

## Amaç ve sınırlar

XP etkinliği, rozet doğrulanmış dönüm noktasını, yetkinlik seviyesi ise mevcut
akademik değerlendirmeyi temsil eder. Birbirinin yerine geçmezler. Yeni rozetler
ilk sürümde ek XP vermez: ödül ekonomisi değişmeden davranış modeli ölçülebilir.
Mevcut 10 XP gönderim, 20 XP onay ve fotoğraf bonusu bu aşamada korunur.
Fotoğraf bonusunu kaldırma/değiştirme ayrı, ileriye dönük sürümlü karardır.
Mesaj, beğeni, dosya sayısı ve yüksek özdeğerlendirme yeni ödül nedeni değildir.

## Yeni rozetler

| Anahtar | Ad | Kesin kazanma koşulu | Tekillik |
| --- | --- | --- | --- |
| first_approved_task | İlk Onaylı Çalışma | En az 1 farklı görev tesliminin mentor tarafından onaylanması | Öğrenci + kural sürümü |
| approved_tasks_5 | Güvenilir Üretim | Aynı grupta 5 farklı görevin halen onaylı teslimi | Öğrenci + grup + kural sürümü |
| feedback_growth | Geri Bildirimle Gelişim | İlk onayından önce gerekçeli düzeltme istenen bir teslimin öğrenci tarafından yeniden gönderilip sonra mentorca onaylanması | Öğrenci + grup + kural sürümü |
| first_competency_target | İlk Yetkinlik Hedefim | Yetkili yeni değerlendirme sonucu mevcut ilerleme hesabının, o andaki aktif bir yetkinlik hedefini ilk kez karşılaması | Öğrenci + grup + kural sürümü |
| reflective_days_5 | Deneyimimi Anlamlandırıyorum | Aynı grupta 5 farklı tarihte gönderilmiş, zorunlu deneyim/öğrenme/özdeğerlendirme alanları dolu günlük ve mentorca katıldı/kısmi katılım kararı | Öğrenci + grup + kural sürümü |
| internship_completed | Staj Yolculuğu Tamamlandı | Yetkili danışmanın mevcut close_internship akışıyla stajı kapatması ve rapor sürümü oluşturması | Öğrenci + grup + kural sürümü |

Günlük rozeti yazı kalitesini veya tam gün çalışmayı kanıtlamaz. Beş farklı
kayıtlı öğrenme gününü temsil eder; kısmi katılım yarım güne çevrilmez. Karar ve
günlük hangi sırayla tamamlanırsa tamamlansın koşul aynı sonucu vermelidir.
Taslak günlük tek başına sayılmaz, kontrol sırasında taslak içeriği paylaşılmaz.
Staj kapanış rozeti bütün yetkinliklerin kazanıldığı iddiasını taşımaz.

## Mevcut rozetler ve seri

- first_task, streak_7 ve streak_30 kimlikleri korunur. Güncel seri koşulları
  sırasıyla ilk görev, 4 ve 8 ardışık haftada yeni görev gönderimidir.
- Eski rozetler yeni hedef olarak gösterilmez; kazanılmış olanlar korunur.
- Yeni rozetler eskilerin yerine yazılmaz. first_task ile first_approved_task
  farklı olaylardır: gönderme ve bağımsız onay.
- Çalışma takvimi/resmî izin modeli belirlenmeden yeni devam serisi eklenmez.
  Mevcut görev serisini “staja düzenli devam” olarak adlandırmak yasaktır.

## Doğrulanabilirlik ve eksik veri

Mevcut submit_assignment yeniden gönderimde reviewed_at/reviewed_by alanlarını
temizler; review_assignment son kararı günceller. Bu yüzden bugünkü satırdan
geçmişte düzeltme istendiği güvenilir biçimde çıkartılamaz.
feedback_growth için ileriye dönük, sunucuda yazılan karar/gönderim olay geçmişi
gerekir. Bildirim metni veya mevcut mentor notundan geçmiş tahmin edilmez.
Yeni olay kaydı eski RPC imzalarını, kapanış kontrollerini ve yetkilendirmeyi korur.

Yetkinlik rozeti get_competency_progress ile aynı yetkili hesaplamayı kullanır;
ayrı bir istemci algoritması olmaz. Özdeğerlendirme puanı veya öz/mentor puanının
yakınlığı ödül ölçütü değildir. Hedefi düşürmek tek başına yeni ödül üretmez.
Hedef, seviye ve dayanak gözlem kimlikleri ödül anında sürümlü olarak saklanır.

## Ödül kaydı ve geri alma

- Sunucuya özel değerlendirme; istemci ödül anahtarı veya miktarı seçemez.
- Yeni kayıt modeli mevcut earned_badges tablosundan ayrı, grup ve kural sürümü
  içermelidir. Mevcut tablo öğrenci/rozet tekilliği nedeniyle grup bazlı hedefleri
  tek başına ifade edemez. Eski ödüller bu değişiklikte taşınmaz/silinmez.
- Kaynak olay, öğrenci, grup, kural sürümü, kazanma zamanı, kanıt özeti ve geçerlilik
  tutulur. UNIQUE kısıtı ve işlem kilidiyle tekrar çağrı/eşzamanlı onay çift ödül
  veya çift bildirim oluşturmaz. Yeni ödül değerlendirmesi ilgili işlemle atomiktir.
- Sonraki normal hedef değişikliği geçmiş başarıyı yeniden yazmaz. Dayanak onayın
  geri çekilmesi, gözlemin silinmesi veya kapanışın yeniden açılması ise doğrulama
  durumunu yeniden değerlendirir. Şart bozulduysa kayıt silinmez; “yeniden doğrulama
  bekliyor” olur. Aynı ödül tekrar geçerli olduğunda yeniden XP verilmez.
- Grup değişimi yeni grubun sayaçlarını eski grubun görev/günleriyle doldurmaz.
  Önceki grup başarıları geçmiş olarak gösterilir; grup arşivi tek başına başarının
  geçersiz olduğu anlamına gelmez. İstemciye başkasının kanıtı sızdırılmaz.

## Geçiş politikası

İlk sürüm ileriye dönük ödüllendirir. Eski kayıtlar kendiliğinden başarı sayılmaz.
İsteğe bağlı geriye dönük dağıtım ayrı bir önizleme ve onay gerektirir. Özellikle
geri bildirim rozeti için eksik tarihçe tamamlanmış gibi gösterilmez.
Mevcut XP bakiyeleri, eski rozetler ve akademik değerlendirmeler değişmez.

## Öğrenci ekranı

Önce kişisel yetkinlik ilerlemesi, sonra “Sıradaki başarın”, ardından aktif/hedef
rozetler ve geçmiş başarılar gelir. Sıralama ikincil bağlantı olarak kalır.
Sayılabilir hedeflerde örneğin “3/5 onaylı görev” gösterilir; hesap sunucudan gelir.
Yüklenemeyen ilerleme sıfır gibi gösterilmez. Kural, dayanak tarihleri ve neden
yeniden doğrulama gerektiği detaydan açılır. Yeni dönem başlamamış bir hedef
“0 başarın var” yerine “bu grupta henüz başlamadı” şeklinde açıklanır.

## Uygulama sırası ve kabul testleri

1. Canlı şema doğrulaması, sürümlü ödül/olay tabloları ve RLS.
2. İlk onay + 5 onaylı görev: mevcut onay yoluna sınırlı entegrasyon.
3. Düzeltme olay geçmişi, yetkinlik ve günlük koşulları.
4. Kapanış/yeniden açma ve kaynak geçersizleştirme kontrolleri.
5. İlerleme RPC'si, öğrenci kartları, 7 dil ve cihaz testi.

Zorunlu testler: tekrar gönder/onay, eşzamanlı karar, yetkisiz yazma/okuma,
düzeltme geçmişi olmayan eski teslim, 4/5 farklı görev sınırı, aynı görevin tekrar
sayılmaması, 4/5 farklı günlük tarihi, taslak/gönderim ve karar sırası, kısmi/izinli/
devamsız ayrımı, onay geri çekme, hedef düşürme, grup değiştirme/arşiv, kapanışı
yeniden açıp kapatma, eski ödüllerin korunması ve bildirim tekilliği.
