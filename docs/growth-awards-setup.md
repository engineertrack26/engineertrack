# Kalıcı rozetler ve birleşik Başarılar ekranı

## Kurulum

Önkoşul: growth-journey-migration.sql ve gerektiğinde
growth-journey-optional-closure-fix.sql uygulanmış olmalıdır. Önce test projesinde
growth-awards-migration.sql, ardından growth-awards-verification.sql çalıştırılır.
Migration eski verileri silmez, XP vermez ve mevcut değerlendirme RPC'lerini değiştirmez.
Canlı SQL kullanıcı tarafından uygulanır. Client artık sync_my_growth_awards
çağırdığı için migration yapılana kadar açık bir kurulum uyarısı gösterir.

## Davranış

- Gelişim ekranında tek Başarılar sekmesi vardır. İkinci bir üç-rozet kataloğu yoktur.
  Katalog grup hedeflerine göre en fazla 22 aşamayı gerçek rozet olarak sunar.
  Sıradaki üç öneri, tüm rozetler ve kazanılanlar aynı bölümün görünümleridir.
- Ekran açıldığında/yenilendiğinde sunucu önce kendi öğrenci hesabının güncel
  metriklerini hesaplar, sağlanan koşulları kalıcı growth_awards kayıtlarına yazar.
  Onay anında arka planda dağıtım veya push bildirimi bu sürümde yoktur. Öğrencinin
  ekranı hiç açılmadan sağlanıp geri çekilen geçici koşullar geçmiş ödül sayılmaz.
- Mevcut geçerli kayıtlar ilk açılışta rozet kazandırabilir. Kazanma tarihi geçmişteki
  olayın tahmini zamanı değil, sunucunun rozeti ilk doğrulayıp kaydettiği zamandır.
  İlk tarih ve metrik kanıtı sonraki yenilemelerde değişmez. Ek XP verilmez.
- Öğrenci/grup/aşama/kural-sürümü PK ve öğrenci bazında transaction kilidi tekrar
  çağrıları tekilleştirir. İstemci öğrenci, grup, eşik veya rozet seçemez.
  Direct tablo erişimi kapalıdır; anonim veya personel çağrısı reddedilir.
- Onay geri çekilirse kayıt silinmez, verified=false olur. Ekranda yeniden doğrulama
  uyarısı çıkar. Koşul tekrar sağlanırsa aynı kaydın doğrulaması yenilenir; ek kayıt,
  XP veya kazanma tarihi oluşmaz. Yeniden kontrol öğrenci ekranını yenileyince yapılır.
- Önceki grup rozetleri kazanılanlarda ayrı açıklamayla korunur. Önceki gruplar bu
  RPC'de yeniden hesaplanmaz; son doğrulanan durumları geçmiş olarak gösterilir.
- Yetkinlik eşiği rozetin içinde sayı olarak saklanır; resmi yetkinlik RPC'si tekrar
  kullanılmaktadır. Rozet akademik sertifika değildir. Hedef düşürülmesi resmi
  hesabı değiştirirse sonraki yenilemede yeni koşul sağlanabilir; bu sürümde ayrı
  hedef-dönemi kilidi veya geçiş onayı yoktur. Eski eşikler/kazanımlar silinmez.
- Kapanış modülü opsiyoneldir: yoksa kapanış rozeti verilmez; diğer aileler çalışır.
- Eski earned_badges kayıtları Başarılar içindeki açılır Geçmiş başarılar alanında
  korunur. Yeni katalog toplamına eski üç hedef eklenmez.

## Testler

`node scripts/test-growth-journey.cjs <PGlite yolu>` metrik SQL'inin yanı sıra ödül
SQL'ini de tekrar uygulayarak sınar: 22 aşama, tekrar yenileme, ilk kazanma tarihinin
korunması, geri çekme/tekrar doğrulama, grup geçişi, kullanıcı izolasyonu ve izinler.
Bu izole test canlı migration ve Expo Go cihaz kontrolünün yerini tutmaz.

Cihazda: iki kez yenileyip sayının artmadığını kontrol edin; tüm rozetleri açın;
Kazanılanlar'da tarihe bakın; mentör onayını geri alıp öğrenci görünümünü yenileyin;
tekrar onaydan sonra aynı rozetin ilk tarihinin korunduğunu doğrulayın.
