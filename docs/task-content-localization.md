# Hazır görev içeriğinin Türkçe gösterimi

## Kapsam

- 480 hazır görevin 1.440 kazanım, görev ve değerlendirme kriteri alanı.
- İngilizce ana kaynak `docs/task-triplets-migration.sql` olarak korunur.
- `src/i18n/task-content/en.json`, bu kaynağın değiştirilmeden alınmış gösterim eşleştirmesidir.
- Türkçe metinler ayrı `tr.json` dosyasındadır. `tr` / `tr-TR` Türkçe, diğer diller mevcut İngilizce metni gösterir.
- Çeviri yalnızca gösterimde uygulanır. Servisler, store'lar, atama taslakları ve veritabanına yazılan ham alanlar çevrilmez.
- Bir alanın tamamı katalogdaki İngilizce kaynakla eşleşiyorsa çevrilir. Değiştirilmiş veya bilinmeyen alan aynen kalır. UUID'ler kurulumlar arasında değişse de eşleştirme çalışır. Baştaki/sondaki boşluklar eşleştirmeyi bozmaz.
- Bir hazır alan düzenlenmeden kaydedilir veya Türkçe varsayılanına geri döndürülürse İngilizce kaynak korunur. Gerçek düzenlemeler yazıldığı dilde saklanır.
- Türkçe çevirisi olmayan veya katalog güncellendiği için artık eşleşmeyen metin İngilizce kalır; eski çeviri yeni kaynak üzerine uygulanmaz.
- Altı hazır yetkinliğin adı da `competencyContent` ile Türkçe gösterilir; arama ve erişilebilirlik etiketleri aynı dil kuralını izler. İngilizce veritabanı isimleri değişmez. KPI açıklamaları bu çevirinin kapsamında değildir. Önceden oluşturulmuş bildirim gövdeleri yeniden yazılmaz.

## Ekranlar

Advisor: hazır görev seçimi, gönderim özeti, taslak/yayınlanmış kartlar ve düzenleme.
Öğrenci: görev listesi, görev detayı, ana sayfadaki görevler.
Mentor: ana sayfa, inceleme kuyruğu, görev değerlendirmesi.
İlgili akış kartları ve staj günlüğündeki görev seçimi de aynı gösterim yardımcı fonksiyonunu kullanır.
Öğrenci, mentor ve advisor aramasında Türkçe gösterim ve İngilizce kaynak aranabilir.

## Çeviri kaynağı ve inceleme

Kullanıcının açık onayıyla yalnızca İngilizce hazır katalog metinleri Google çeviri
servisine gönderilerek ilk taslak oluşturuldu. Hesap bilgileri, öğrenci kayıtları,
anahtarlar veya veritabanı erişimi kullanılmadı. Uygulama çalışırken çeviri servisine
bağlanılmaz; SQL migration veya yeni sunucu fonksiyonu gerekmez.

Bağlamsal dil kontrolündeki düzeltmeler `task-content-tr-corrections.json` içinde
sürümlenir. Yazılım, mesleki iletişim, raporlama ve gizlilik terimleri kontrol edildi;
özellikle redacted = hassas bilgileri gizlenmiş, onboarding = uyum eğitimi,
redlines = işaretlenmiş düzeltmeler, float = zaman esnekliği ayrımları düzeltildi.
Sayısal eşikler ve referans numaraları otomatik testlerle karşılaştırılır.
Bu kontrol, eğitim içeriği sahibinin nihai pedagojik onayının yerine geçmez.

Kaynakta `teamwork.4.1.10` içindeki bağlam dışı `scripture` ifadesi Türkçede
bağlama uygun genel bir ifade olan “yazılı kanıtlar” olarak yorumlandı.
İngilizce kaynak değiştirilmedi. İçerik sahibi bu kaynak ifadesini netleştirebilir.
Kaynakta geçen sanal simülasyon/oyun görevleri ve uygulama özelliklerine ilişkin
iddialar bu çalışmada yeniden tasarlanmadı; çeviri yeni bir özellik uygulamaz.

## Bakım ve kontroller

1. `node scripts/task-content-catalog.cjs --check`: İngilizce kaynak eşitliği.
2. `node scripts/review-task-content.cjs`: tamamlanmış taslağa incelenmiş düzeltmeleri uygular; ağ erişimi yoktur.
3. `node node_modules/jest/bin/jest.js --runInBand taskContent`: kapsam, dil dönüşü, özel metinlerin korunması, sayı/gizlilik kontrolü ve arama testleri.
4. `node node_modules/typescript/bin/tsc --noEmit`.

`translate-task-content.cjs` yalnızca ilk taslak için kullanılan manuel araçtır;
normal geliştirme/test/uygulama akışında çalışmaz. Harici servise göndermek için
ayrıca `--allow-external-translation` parametresi gerekir. Servis uç noktası kalıcı
bir API sözleşmesi değildir; uygulama ona bağımlı değildir. Mevcut çevirileri atlar.
İngilizce kaynak değişirse katalog oluşturucu, mevcut çevirileri sessizce yeni
kaynağa bağlamamak için durur; etkilenen kayıtlar birlikte incelenmelidir.

## Expo Go kabul testi (cihazda bekliyor)

1. Türkçe seçin; advisor kataloğunda ve öğrenci görev detayında üç alanı kontrol edin.
2. İngilizceye, ardından Almancaya geçin: hazır içerik İngilizce olmalı.
3. Yeniden Türkçeye dönün: sayfayı yeniden yüklemeden Türkçe görünmeli.
4. Advisor olarak hazır görevi düzenlemeden gönderin; İngilizce dilde kaynak korunmalı.
5. Yalnızca açıklamayı/teslim tarihini değiştirin: üç hazır alanın dil davranışı değişmemeli.
6. Bir görev alanını özel metinle değiştirin: o alan dil değişiminde aynen kalmalı, diğer hazır alanlar çevrilmeli.
7. Mentor inceleme ekranında kriteri ve Türkçe görev aramasını kontrol edin.
