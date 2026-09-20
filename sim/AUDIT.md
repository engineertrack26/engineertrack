# Audit

_Run 2026-09-20T13:34:53.114Z by the auditor (read-only sign-ins as everyone)._

**Summary.** Isolation: 7 students × (another student's submissions 0 rows · unfiltered submissions select returns only own rows · internship_week/progress/self-vs-mentor/report of another student refused ID_FORBIDDEN/ROLE_NOT_ALLOWED/SELF_ASSESSMENT_FORBIDDEN/REPORT_FORBIDDEN · internship_days/kpi_observations/notifications of another student: permission denied or 0 rows); 7 mentors × (unfiltered submissions = own student only · non-linked student's week/report/progress refused · stream refused NOT_IN_GROUP · internship_days of another student refused); outsider mentor (Ayça) on Ayşe's report → REPORT_FORBIDDEN; advisor on a foreign group's attendance → ID_FORBIDDEN. No leak. Consistency: every mentor's pending count = their student's `submitted` rows (Ayça 1, all others 0); attendance table = each student's own week for all 7; advisor counts (26 approved, 1 awaiting) = students' rows; stream 34 posts for all 8 readers, 25 task cards = 26 approvals − 1 unshared; leaderboard identical for all 7; announcement comment set identical for advisor and Can (1 comment, Zeynep's). Screen notes at the end filed 8 defects (2 wrong, 6 rough).

## Elif Kaya (student)

- tasks (my-tasks): ["Set a logical workflow diagram:approved","Record measurements, outputs, :approved","Send a direct message to a pee:approved","Type a brief summary of a stan:approved","Pick one routine task with an :todo","Upload, format, or merge the c:todo"]
- task rows / submissions rows: 6 / 4
- submitted (awaiting mentor): 0
- approved / shared: 4 / 4
- progress (growth): ["Engineering Problem Solving:0/2","Technical Documentation:0/3","Professional Communication:0/2","Digital Tool Proficiency:0/3","Responsibility & Ethics:0/2","Collaboration & Teamwork:0/3"]
- self vs mentor: ["Professional Communication: tasks 1 self 2 mentor 2 gap 0 over 0 under 0","Digital Tool Proficiency: tasks 1 self 2 mentor 2 gap 0 over 0 under 0","Technical Documentation: tasks 1 self 2 mentor 3 gap 1 over 0 under 1","Engineering Problem Solving: tasks 1 self 1 mentor 2 gap 1 over 0 under 1"]
- week (internship days): ["2026-09-14:present/submitted","2026-09-15:present/submitted","2026-09-16:present/submitted","2026-09-17:present/submitted","2026-09-18:present/submitted","2026-09-19:present/submitted"]
- totals: {"partial":0,"pending":0,"present":6,"corrections":0,"missingLogs":0}
- stream count (paged, all): 34 {"task":25,"announcement":2,"poll":1,"assignment":6}
- my task cards in the stream: 4 of 4 approved (4 shared)
- conversations: ["member:Burak Şahin:unread 0","member:Deniz Yıldırım:unread 0"]
- unread: 0
- notifications: 10 — {"feed_announcement":1,"direct_message":5,"level_up":1,"internship_feedback":1,"internship_attendance":1,"badge_earned":1}
- notification titles (first 6): ["feed_announcement:New announcement","direct_message:New message","direct_message:New message","level_up:Level Up!","internship_feedback:Feedback on your internship day","internship_attendance:Attendance decided"]
- closure: {"closed":false,"closedAt":null,"closedBy":null,"reopenedAt":null,"reopenReason":null,"reportVersion":null,"pendingReviews":0}
- leaderboard: ["Burak:145","Elif:132","Can:132","Mert:132","Ayşe:132","Deniz:99","Zeynep:96"]
- isolation: Burak Şahin's submissions: 0 rows
- isolation: unfiltered submissions select: 4 rows, 0 not mine
- isolation: refusals (week/progress/selfVsMentor/report): refused/refused/refused/refused
- isolation: Burak Şahin's internship_days rows: 0
- isolation: Burak Şahin's kpi_observations rows: 0
- isolation: Burak Şahin's notifications rows: 0

## Burak Şahin (student)

- tasks (my-tasks): ["Set a logical workflow diagram:approved","Record measurements, outputs, :approved","Send a direct message to a pee:submitted","Type a brief summary of a stan:approved","Pick one routine task with an :approved","Upload, format, or merge the c:todo"]
- task rows / submissions rows: 6 / 5
- submitted (awaiting mentor): 1
- approved / shared: 4 / 4
- progress (growth): ["Engineering Problem Solving:0/2","Technical Documentation:0/3","Professional Communication:0/2","Digital Tool Proficiency:0/3","Responsibility & Ethics:0/2","Collaboration & Teamwork:0/3"]
- self vs mentor: ["Digital Tool Proficiency: tasks 1 self 2 mentor 2 gap 0 over 0 under 0","Technical Documentation: tasks 1 self 2 mentor 1 gap -1 over 1 under 0","Responsibility & Ethics: tasks 1 self 2 mentor 2 gap 0 over 0 under 0","Engineering Problem Solving: tasks 1 self 2 mentor 1 gap -1 over 1 under 0"]
- week (internship days): ["2026-09-17:present/submitted","2026-09-18:present/submitted","2026-09-19:present/draft"]
- totals: {"partial":0,"pending":0,"present":3,"corrections":0,"missingLogs":1}
- stream count (paged, all): 34 {"task":25,"announcement":2,"poll":1,"assignment":6}
- my task cards in the stream: 4 of 4 approved (4 shared)
- conversations: ["member:Elif Kaya:unread 0"]
- unread: 0
- notifications: 8 — {"feed_announcement":1,"general":1,"feed_comment":1,"level_up":1,"internship_feedback":1,"internship_attendance":1,"badge_earned":1,"direct_message":1}
- notification titles (first 6): ["feed_announcement:New announcement","general:Görev hatırlatması","feed_comment:New comment","level_up:Level Up!","internship_feedback:Feedback on your internship day","internship_attendance:Attendance decided"]
- closure: {"closed":false,"closedAt":null,"closedBy":null,"reopenedAt":null,"reopenReason":null,"reportVersion":null,"pendingReviews":1}
- leaderboard: ["Burak:145","Elif:132","Can:132","Mert:132","Ayşe:132","Deniz:99","Zeynep:96"]
- isolation: Elif Kaya's submissions: 0 rows
- isolation: unfiltered submissions select: 5 rows, 0 not mine
- isolation: refusals (week/progress/selfVsMentor/report): refused/refused/refused/refused
- isolation: Elif Kaya's internship_days rows: 0
- isolation: Elif Kaya's kpi_observations rows: 0
- isolation: Elif Kaya's notifications rows: 0

## Zeynep Arslan (student)

- tasks (my-tasks): ["Set a logical workflow diagram:approved","Record measurements, outputs, :approved","Send a direct message to a pee:approved","Type a brief summary of a stan:todo","Pick one routine task with an :todo","Upload, format, or merge the c:todo"]
- task rows / submissions rows: 6 / 3
- submitted (awaiting mentor): 0
- approved / shared: 3 / 2
- progress (growth): ["Engineering Problem Solving:0/2","Technical Documentation:0/3","Professional Communication:0/2","Digital Tool Proficiency:0/3","Responsibility & Ethics:0/2","Collaboration & Teamwork:0/3"]
- self vs mentor: ["Professional Communication: tasks 1 self 2 mentor 2 gap 0 over 0 under 0","Technical Documentation: tasks 1 self 2 mentor 2 gap 0 over 0 under 0","Engineering Problem Solving: tasks 1 self 2 mentor 2 gap 0 over 0 under 0"]
- week (internship days): ["2026-09-14:present/submitted","2026-09-15:present/submitted","2026-09-16:present/submitted","2026-09-17:present/submitted","2026-09-18:present/submitted","2026-09-19:present/submitted"]
- totals: {"partial":0,"pending":0,"present":6,"corrections":0,"missingLogs":0}
- stream count (paged, all): 34 {"task":25,"announcement":2,"poll":1,"assignment":6}
- my task cards in the stream: 2 of 3 approved (2 shared)
- conversations: []
- unread: 0
- notifications: 3 — {"feed_announcement":1,"internship_attendance":1,"badge_earned":1}
- notification titles (first 6): ["feed_announcement:New announcement","internship_attendance:Attendance decided","badge_earned:Badge Earned!"]
- closure: {"closed":false,"closedAt":null,"closedBy":null,"reopenedAt":null,"reopenReason":null,"reportVersion":null,"pendingReviews":0}
- leaderboard: ["Burak:145","Elif:132","Can:132","Mert:132","Ayşe:132","Deniz:99","Zeynep:96"]
- isolation: Elif Kaya's submissions: 0 rows
- isolation: unfiltered submissions select: 3 rows, 0 not mine
- isolation: refusals (week/progress/selfVsMentor/report): refused/refused/refused/refused
- isolation: Elif Kaya's internship_days rows: 0
- isolation: Elif Kaya's kpi_observations rows: 0
- isolation: Elif Kaya's notifications rows: 0

## Mert Yılmaz (student)

- tasks (my-tasks): ["Set a logical workflow diagram:approved","Record measurements, outputs, :approved","Send a direct message to a pee:approved","Type a brief summary of a stan:approved","Pick one routine task with an :todo","Upload, format, or merge the c:todo"]
- task rows / submissions rows: 6 / 4
- submitted (awaiting mentor): 0
- approved / shared: 4 / 4
- progress (growth): ["Engineering Problem Solving:0/2","Technical Documentation:0/3","Professional Communication:0/2","Digital Tool Proficiency:0/3","Responsibility & Ethics:0/2","Collaboration & Teamwork:0/3"]
- self vs mentor: ["Professional Communication: tasks 1 self 3 mentor 1 gap -2 over 1 under 0","Digital Tool Proficiency: tasks 1 self 3 mentor 1 gap -2 over 1 under 0","Technical Documentation: tasks 1 self 3 mentor 1 gap -2 over 1 under 0","Engineering Problem Solving: tasks 1 self 3 mentor 1 gap -2 over 1 under 0"]
- week (internship days): ["2026-09-14:present/submitted","2026-09-15:present/submitted","2026-09-16:present/submitted","2026-09-17:present/submitted","2026-09-18:present/submitted","2026-09-19:present/submitted"]
- totals: {"partial":0,"pending":0,"present":6,"corrections":0,"missingLogs":0}
- stream count (paged, all): 34 {"task":25,"announcement":2,"poll":1,"assignment":6}
- my task cards in the stream: 4 of 4 approved (4 shared)
- conversations: []
- unread: 0
- notifications: 4 — {"feed_announcement":1,"level_up":1,"internship_attendance":1,"badge_earned":1}
- notification titles (first 6): ["feed_announcement:New announcement","level_up:Level Up!","internship_attendance:Attendance decided","badge_earned:Badge Earned!"]
- closure: {"closed":false,"closedAt":null,"closedBy":null,"reopenedAt":null,"reopenReason":null,"reportVersion":null,"pendingReviews":0}
- leaderboard: ["Burak:145","Elif:132","Can:132","Mert:132","Ayşe:132","Deniz:99","Zeynep:96"]
- isolation: Elif Kaya's submissions: 0 rows
- isolation: unfiltered submissions select: 4 rows, 0 not mine
- isolation: refusals (week/progress/selfVsMentor/report): refused/refused/refused/refused
- isolation: Elif Kaya's internship_days rows: 0
- isolation: Elif Kaya's kpi_observations rows: 0
- isolation: Elif Kaya's notifications rows: 0

## Ayşe Çelik (student)

- tasks (my-tasks): ["Set a logical workflow diagram:approved","Record measurements, outputs, :approved","Send a direct message to a pee:approved","Type a brief summary of a stan:approved","Pick one routine task with an :todo","Upload, format, or merge the c:todo"]
- task rows / submissions rows: 6 / 4
- submitted (awaiting mentor): 0
- approved / shared: 4 / 4
- progress (growth): ["Engineering Problem Solving:0/2","Technical Documentation:0/3","Professional Communication:0/2","Digital Tool Proficiency:0/3","Responsibility & Ethics:0/2","Collaboration & Teamwork:0/3"]
- self vs mentor: ["Professional Communication: tasks 1 self 2 mentor 2 gap 0 over 0 under 0","Digital Tool Proficiency: tasks 1 self 2 mentor 2 gap 0 over 0 under 0","Technical Documentation: tasks 1 self 2 mentor 2 gap 0 over 0 under 0","Engineering Problem Solving: tasks 1 self 1 mentor 2 gap 1 over 0 under 1"]
- week (internship days): ["2026-09-14:present/submitted","2026-09-15:present/submitted","2026-09-16:present/submitted","2026-09-17:present/submitted","2026-09-18:present/submitted","2026-09-19:present/submitted"]
- totals: {"partial":0,"pending":0,"present":6,"corrections":0,"missingLogs":0}
- stream count (paged, all): 34 {"task":25,"announcement":2,"poll":1,"assignment":6}
- my task cards in the stream: 4 of 4 approved (4 shared)
- conversations: []
- unread: 0
- notifications: 7 — {"internship_closed":2,"internship_reopened":1,"feed_announcement":1,"level_up":1,"internship_attendance":1,"badge_earned":1}
- notification titles (first 6): ["internship_closed:Internship closed","internship_reopened:Internship reopened","internship_closed:Internship closed","feed_announcement:New announcement","level_up:Level Up!","internship_attendance:Attendance decided"]
- closure: {"closed":true,"closedAt":"2026-09-20T13:22:06.673683+00:00","closedBy":"Selin Aydın","reopenedAt":null,"reopenReason":null,"reportVersion":2,"pendingReviews":0}
- leaderboard: ["Burak:145","Elif:132","Can:132","Mert:132","Ayşe:132","Deniz:99","Zeynep:96"]
- report (first line / length): # Internship report ÔÇö Ayşe Çelik / 2519 chars; version line: Report version | 2 |
- isolation: Elif Kaya's submissions: 0 rows
- isolation: unfiltered submissions select: 4 rows, 0 not mine
- isolation: refusals (week/progress/selfVsMentor/report): refused/refused/refused/refused
- isolation: Elif Kaya's internship_days rows: 0
- isolation: Elif Kaya's kpi_observations rows: 0
- isolation: Elif Kaya's notifications rows: 0

## Can Doğan (student)

- tasks (my-tasks): ["Set a logical workflow diagram:approved","Record measurements, outputs, :approved","Send a direct message to a pee:approved","Type a brief summary of a stan:approved","Pick one routine task with an :todo","Upload, format, or merge the c:todo"]
- task rows / submissions rows: 6 / 4
- submitted (awaiting mentor): 0
- approved / shared: 4 / 4
- progress (growth): ["Engineering Problem Solving:0/2","Technical Documentation:0/3","Professional Communication:0/2","Digital Tool Proficiency:0/3","Responsibility & Ethics:0/2","Collaboration & Teamwork:0/3"]
- self vs mentor: ["Professional Communication: tasks 1 self 2 mentor 3 gap 1 over 0 under 1","Digital Tool Proficiency: tasks 1 self 2 mentor 2 gap 0 over 0 under 0","Technical Documentation: tasks 1 self 1 mentor 1 gap 0 over 0 under 0","Engineering Problem Solving: tasks 1 self 1 mentor 2 gap 1 over 0 under 1"]
- week (internship days): ["2026-09-14:present/submitted","2026-09-15:present/submitted","2026-09-16:partial/submitted","2026-09-17:present/submitted","2026-09-18:present/submitted","2026-09-19:present/submitted"]
- totals: {"partial":1,"pending":0,"present":5,"corrections":0,"missingLogs":0}
- stream count (paged, all): 34 {"task":25,"announcement":2,"poll":1,"assignment":6}
- my task cards in the stream: 4 of 4 approved (4 shared)
- conversations: ["case:Can Doğan:unread 1","mentor:Selin Kurt:unread 0","member:Selin Aydın:unread 0"]
- unread: 1
- notifications: 10 — {"feed_announcement":1,"direct_message":4,"level_up":1,"internship_feedback":1,"internship_attendance":2,"badge_earned":1}
- notification titles (first 6): ["feed_announcement:New announcement","direct_message:New message","direct_message:Case opened","direct_message:New message","level_up:Level Up!","internship_feedback:Feedback on your internship day"]
- closure: {"closed":false,"closedAt":null,"closedBy":null,"reopenedAt":null,"reopenReason":null,"reportVersion":null,"pendingReviews":0}
- leaderboard: ["Burak:145","Elif:132","Can:132","Mert:132","Ayşe:132","Deniz:99","Zeynep:96"]
- announcement comment authors: ["0588262e:Tamam."]
- isolation: Elif Kaya's submissions: 0 rows
- isolation: unfiltered submissions select: 4 rows, 0 not mine
- isolation: refusals (week/progress/selfVsMentor/report): refused/refused/refused/refused
- isolation: Elif Kaya's internship_days rows: 0
- isolation: Elif Kaya's kpi_observations rows: 0
- isolation: Elif Kaya's notifications rows: 0

## Deniz Yıldırım (student)

- tasks (my-tasks): ["Set a logical workflow diagram:approved","Record measurements, outputs, :approved","Send a direct message to a pee:approved","Type a brief summary of a stan:todo","Pick one routine task with an :todo","Upload, format, or merge the c:todo"]
- task rows / submissions rows: 6 / 3
- submitted (awaiting mentor): 0
- approved / shared: 3 / 3
- progress (growth): ["Engineering Problem Solving:0/2","Technical Documentation:0/3","Professional Communication:0/2","Digital Tool Proficiency:0/3","Responsibility & Ethics:0/2","Collaboration & Teamwork:0/3"]
- self vs mentor: ["Professional Communication: tasks 1 self 2 mentor 2 gap 0 over 0 under 0","Technical Documentation: tasks 1 self 2 mentor 2 gap 0 over 0 under 0","Engineering Problem Solving: tasks 1 self 1 mentor 1 gap 0 over 0 under 0"]
- week (internship days): ["2026-09-14:present/submitted","2026-09-15:present/submitted","2026-09-16:excused/submitted","2026-09-17:present/submitted","2026-09-18:present/submitted","2026-09-19:present/submitted"]
- totals: {"partial":0,"pending":0,"present":5,"corrections":0,"missingLogs":0}
- stream count (paged, all): 34 {"task":25,"announcement":2,"poll":1,"assignment":6}
- my task cards in the stream: 3 of 3 approved (3 shared)
- conversations: ["member:Elif Kaya:unread 0"]
- unread: 0
- notifications: 5 — {"feed_announcement":1,"internship_feedback":1,"internship_attendance":2,"badge_earned":1}
- notification titles (first 6): ["feed_announcement:New announcement","internship_feedback:Feedback on your internship day","internship_attendance:Attendance decided","internship_attendance:Attendance decided","badge_earned:Badge Earned!"]
- closure: {"closed":false,"closedAt":null,"closedBy":null,"reopenedAt":null,"reopenReason":null,"reportVersion":null,"pendingReviews":0}
- leaderboard: ["Burak:145","Elif:132","Can:132","Mert:132","Ayşe:132","Deniz:99","Zeynep:96"]
- isolation: Elif Kaya's submissions: 0 rows
- isolation: unfiltered submissions select: 3 rows, 0 not mine
- isolation: refusals (week/progress/selfVsMentor/report): refused/refused/refused/refused
- isolation: Elif Kaya's internship_days rows: 0
- isolation: Elif Kaya's kpi_observations rows: 0
- isolation: Elif Kaya's notifications rows: 0

## Hakan Demir (mentor of elif-kaya)

- pending reviews: 0 []
- submissions visible (unfiltered select): 4 rows, 0 of other students
- people: ["Elif Kaya (Marmara Su ve Kanalizasyon İdaresi) 2026-09-13→2026-09-19"]
- contacts: ["Selin Aydın (advisor)","Elif Kaya (student)"]
- conversations: []
- unread: 0
- notifications: 10 — {"task_submitted":4,"internship_log_submitted":6}
- student's week (mentor view): ["2026-09-14:present/submitted","2026-09-15:present/submitted","2026-09-16:present/submitted","2026-09-17:present/submitted","2026-09-18:present/submitted","2026-09-19:present/submitted"]
- student's progress (mentor view): ["Engineering Problem Solving:0/2","Technical Documentation:0/3","Professional Communication:0/2","Digital Tool Proficiency:0/3","Responsibility & Ethics:0/2","Collaboration & Teamwork:0/3"]
- student's self vs mentor (mentor view): ["Professional Communication: gap 0 over 0","Digital Tool Proficiency: gap 0 over 0","Technical Documentation: gap 1 over 0","Engineering Problem Solving: gap 1 over 0"]
- isolation vs Burak Şahin (week/report/progress) + stream: refused/refused/refused/refused
- isolation: Burak Şahin's internship_days rows: 0

## Ayça Yıldız (mentor of burak-sahin)

- pending reviews: 1 ["99a265a1:Send a direct message to "]
- submissions visible (unfiltered select): 5 rows, 0 of other students
- people: ["Burak Şahin (Ege Çevre Danışmanlık) 2026-09-13→2026-09-19"]
- contacts: ["Selin Aydın (advisor)","Burak Şahin (student)"]
- conversations: []
- unread: 0
- notifications: 8 — {"task_submitted":6,"internship_log_submitted":2}
- student's week (mentor view): ["2026-09-17:present/submitted","2026-09-18:present/submitted","2026-09-19:present/draft"]
- student's progress (mentor view): ["Engineering Problem Solving:0/2","Technical Documentation:0/3","Professional Communication:0/2","Digital Tool Proficiency:0/3","Responsibility & Ethics:0/2","Collaboration & Teamwork:0/3"]
- student's self vs mentor (mentor view): ["Digital Tool Proficiency: gap 0 over 0","Technical Documentation: gap -1 over 1","Responsibility & Ethics: gap 0 over 0","Engineering Problem Solving: gap -1 over 1"]
- isolation vs Elif Kaya (week/report/progress) + stream: refused/refused/refused/refused
- isolation: Elif Kaya's internship_days rows: 0

## Murat Koç (mentor of zeynep-arslan)

- pending reviews: 0 []
- submissions visible (unfiltered select): 3 rows, 0 of other students
- people: ["Zeynep Arslan (Ankara Büyükşehir Belediyesi Çevre Koruma Dairesi) 2026-09-13→2026-09-19"]
- contacts: ["Selin Aydın (advisor)","Zeynep Arslan (student)"]
- conversations: []
- unread: 0
- notifications: 9 — {"task_submitted":3,"internship_log_submitted":6}
- student's week (mentor view): ["2026-09-14:present/submitted","2026-09-15:present/submitted","2026-09-16:present/submitted","2026-09-17:present/submitted","2026-09-18:present/submitted","2026-09-19:present/submitted"]
- student's progress (mentor view): ["Engineering Problem Solving:0/2","Technical Documentation:0/3","Professional Communication:0/2","Digital Tool Proficiency:0/3","Responsibility & Ethics:0/2","Collaboration & Teamwork:0/3"]
- student's self vs mentor (mentor view): ["Professional Communication: gap 0 over 0","Technical Documentation: gap 0 over 0","Engineering Problem Solving: gap 0 over 0"]
- isolation vs Elif Kaya (week/report/progress) + stream: refused/refused/refused/refused
- isolation: Elif Kaya's internship_days rows: 0

## Gamze Öztürk (mentor of mert-yilmaz)

- pending reviews: 0 []
- submissions visible (unfiltered select): 4 rows, 0 of other students
- people: ["Mert Yılmaz (İzmir Atık Yönetimi A.Ş.) 2026-09-13→2026-09-19"]
- contacts: ["Selin Aydın (advisor)","Mert Yılmaz (student)"]
- conversations: []
- unread: 0
- notifications: 10 — {"task_submitted":4,"internship_log_submitted":6}
- student's week (mentor view): ["2026-09-14:present/submitted","2026-09-15:present/submitted","2026-09-16:present/submitted","2026-09-17:present/submitted","2026-09-18:present/submitted","2026-09-19:present/submitted"]
- student's progress (mentor view): ["Engineering Problem Solving:0/2","Technical Documentation:0/3","Professional Communication:0/2","Digital Tool Proficiency:0/3","Responsibility & Ethics:0/2","Collaboration & Teamwork:0/3"]
- student's self vs mentor (mentor view): ["Professional Communication: gap -2 over 1","Digital Tool Proficiency: gap -2 over 1","Technical Documentation: gap -2 over 1","Engineering Problem Solving: gap -2 over 1"]
- isolation vs Elif Kaya (week/report/progress) + stream: refused/refused/refused/refused
- isolation: Elif Kaya's internship_days rows: 0

## Emre Aksoy (mentor of ayse-celik)

- pending reviews: 0 []
- submissions visible (unfiltered select): 4 rows, 0 of other students
- people: ["Ayşe Çelik (Karadeniz ÇED ve Çevre Hizmetleri) 2026-09-13→2026-09-19"]
- contacts: ["Selin Aydın (advisor)","Ayşe Çelik (student)"]
- conversations: []
- unread: 0
- notifications: 13 — {"internship_closed":2,"internship_reopened":1,"task_submitted":4,"internship_log_submitted":6}
- student's week (mentor view): ["2026-09-14:present/submitted","2026-09-15:present/submitted","2026-09-16:present/submitted","2026-09-17:present/submitted","2026-09-18:present/submitted","2026-09-19:present/submitted"]
- student's progress (mentor view): ["Engineering Problem Solving:0/2","Technical Documentation:0/3","Professional Communication:0/2","Digital Tool Proficiency:0/3","Responsibility & Ethics:0/2","Collaboration & Teamwork:0/3"]
- student's self vs mentor (mentor view): ["Professional Communication: gap 0 over 0","Digital Tool Proficiency: gap 0 over 0","Technical Documentation: gap 0 over 0","Engineering Problem Solving: gap 1 over 0"]
- isolation vs Elif Kaya (week/report/progress) + stream: refused/refused/refused/refused
- isolation: Elif Kaya's internship_days rows: 0

## Selin Kurt (mentor of can-dogan)

- pending reviews: 0 []
- submissions visible (unfiltered select): 4 rows, 0 of other students
- people: ["Can Doğan (DSİ 5. Bölge Su Kalitesi Laboratuvarı) 2026-09-13→2026-09-19"]
- contacts: ["Selin Aydın (advisor)","Can Doğan (student)"]
- conversations: ["case:Can Doğan","mentor:Can Doğan"]
- unread: 2
- notifications: 14 — {"direct_message":4,"task_submitted":4,"internship_log_submitted":6}
- student's week (mentor view): ["2026-09-14:present/submitted","2026-09-15:present/submitted","2026-09-16:partial/submitted","2026-09-17:present/submitted","2026-09-18:present/submitted","2026-09-19:present/submitted"]
- student's progress (mentor view): ["Engineering Problem Solving:0/2","Technical Documentation:0/3","Professional Communication:0/2","Digital Tool Proficiency:0/3","Responsibility & Ethics:0/2","Collaboration & Teamwork:0/3"]
- student's self vs mentor (mentor view): ["Professional Communication: gap 1 over 0","Digital Tool Proficiency: gap 0 over 0","Technical Documentation: gap 0 over 0","Engineering Problem Solving: gap 1 over 0"]
- isolation vs Elif Kaya (week/report/progress) + stream: refused/refused/refused/refused
- isolation: Elif Kaya's internship_days rows: 0

## Oğuz Arı (mentor of deniz-yildirim)

- pending reviews: 0 []
- submissions visible (unfiltered select): 3 rows, 0 of other students
- people: ["Deniz Yıldırım (Boğaziçi Geri Dönüşüm Tesisleri) 2026-09-13→2026-09-19"]
- contacts: ["Selin Aydın (advisor)","Deniz Yıldırım (student)"]
- conversations: []
- unread: 0
- notifications: 10 — {"internship_log_submitted":7,"task_submitted":3}
- student's week (mentor view): ["2026-09-14:present/submitted","2026-09-15:present/submitted","2026-09-16:excused/submitted","2026-09-17:present/submitted","2026-09-18:present/submitted","2026-09-19:present/submitted"]
- student's progress (mentor view): ["Engineering Problem Solving:0/2","Technical Documentation:0/3","Professional Communication:0/2","Digital Tool Proficiency:0/3","Responsibility & Ethics:0/2","Collaboration & Teamwork:0/3"]
- student's self vs mentor (mentor view): ["Professional Communication: gap 0 over 0","Technical Documentation: gap 0 over 0","Engineering Problem Solving: gap 0 over 0"]
- isolation vs Elif Kaya (week/report/progress) + stream: refused/refused/refused/refused
- isolation: Elif Kaya's internship_days rows: 0

## Selin Aydın (advisor)

- attendance (students): ["Ayşe Çelik: P6 p0 E0 A0 ?0 corr0 logs6 rec6/5/5 unrec0 mentor=Emre Aksoy","Burak Şahin: P3 p0 E0 A0 ?0 corr0 logs2 rec3/5/5 unrec2 mentor=Ayça Yıldız","Can Doğan: P5 p1 E0 A0 ?0 corr0 logs6 rec6/5/5 unrec0 mentor=Selin Kurt","Deniz Yıldırım: P5 p0 E1 A0 ?0 corr0 logs6 rec6/5/5 unrec0 mentor=Oğuz Arı","Elif Kaya: P6 p0 E0 A0 ?0 corr0 logs6 rec6/5/5 unrec0 mentor=Hakan Demir","Mert Yılmaz: P6 p0 E
- attendance (days rows): 39
- attendance student row keys: ["id","name","absent","mentor","company","excused","partial","pending","present","recorded","unrecorded","corrections","expectedDays","expectedSoFar","submittedLogs"]
- counts: [{"assignment_id":"1591a485-21dd-429a-90aa-7cfd74bae804","submitted":7,"approved":6,"needs_revision":0},{"assignment_id":"1f33b091-3224-4d46-beb9-2f49ec67aa7c","submitted":7,"approved":7,"needs_revision":0},{"assignment_id":"34abb4e7-39b5-4365-8cb6-56786efe5bc5","submitted":1,"approved":1,"needs_revision":0},{"assignment_id":"45e71428-169c-44fc-b055-e5f5ea417dca","submitted":7,"approved":7,"needs_
- students' own totals: approved 26, awaiting mentor 1, members 7
- pending drafts: 0 []
- members: 7 ["Elif Kaya","Burak Şahin","Ayşe Çelik","Zeynep Arslan","Deniz Yıldırım","Mert Yılmaz","Can Doğan"]
- stream count (paged, all): 34 {"task":25,"announcement":2,"poll":1,"assignment":6}
- task cards by author: {"Ayşe Çelik":4,"Burak Şahin":4,"Zeynep Arslan":2,"Deniz Yıldırım":3,"Can Doğan":4,"Mert Yılmaz":4,"Elif Kaya":4}
- longest task-card title: 152
- announcement comment authors: ["0588262e:Tamam."]
- announcement card: likes 5 comments 1 attachments 3
- poll card: total 6 ["Atıksu arıtma p:5","ÇED mevzuatı:1","Saha ölçüm tekn:0","Rapor yazımı:0"]
- Elif Kaya (monitor): progress problem_solving:0/2 documentation:0/3 communication:0/2 digital_tools:0/3 ethics:0/2 teamwork:0/3 | gaps communication:0 digital_tools:0 documentation:1 problem_solving:1 | closure {"closed":false,"closedAt":null,"closedBy":null,"reopenedAt":null,"reopenReason":null,"reportVersion":null,"pendingReviews":0}
- Burak Şahin (monitor): progress problem_solving:0/2 documentation:0/3 communication:0/2 digital_tools:0/3 ethics:0/2 teamwork:0/3 | gaps digital_tools:0 documentation:-1 ethics:0 problem_solving:-1 | closure {"closed":false,"closedAt":null,"closedBy":null,"reopenedAt":null,"reopenReason":null,"reportVersion":null,"pendingReviews":1}
- Zeynep Arslan (monitor): progress problem_solving:0/2 documentation:0/3 communication:0/2 digital_tools:0/3 ethics:0/2 teamwork:0/3 | gaps communication:0 documentation:0 problem_solving:0 | closure {"closed":false,"closedAt":null,"closedBy":null,"reopenedAt":null,"reopenReason":null,"reportVersion":null,"pendingReviews":0}
- Mert Yılmaz (monitor): progress problem_solving:0/2 documentation:0/3 communication:0/2 digital_tools:0/3 ethics:0/2 teamwork:0/3 | gaps communication:-2 digital_tools:-2 documentation:-2 problem_solving:-2 | closure {"closed":false,"closedAt":null,"closedBy":null,"reopenedAt":null,"reopenReason":null,"reportVersion":null,"pendingReviews":0}
- Ayşe Çelik (monitor): progress problem_solving:0/2 documentation:0/3 communication:0/2 digital_tools:0/3 ethics:0/2 teamwork:0/3 | gaps communication:0 digital_tools:0 documentation:0 problem_solving:1 | closure {"closed":true,"closedAt":"2026-09-20T13:22:06.673683+00:00","closedBy":"Selin Aydın","reopenedAt":null,"reopenReason":null,"reportVersion":2,"pendingReviews":0}
- Can Doğan (monitor): progress problem_solving:0/2 documentation:0/3 communication:0/2 digital_tools:0/3 ethics:0/2 teamwork:0/3 | gaps communication:1 digital_tools:0 documentation:0 problem_solving:1 | closure {"closed":false,"closedAt":null,"closedBy":null,"reopenedAt":null,"reopenReason":null,"reportVersion":null,"pendingReviews":0}
- Deniz Yıldırım (monitor): progress problem_solving:0/2 documentation:0/3 communication:0/2 digital_tools:0/3 ethics:0/2 teamwork:0/3 | gaps communication:0 documentation:0 problem_solving:0 | closure {"closed":false,"closedAt":null,"closedBy":null,"reopenedAt":null,"reopenReason":null,"reportVersion":null,"pendingReviews":0}
- Ayşe report: 2519 chars; Report version | 2 |; headings: # Internship report ÔÇö Ayşe Çelik | ## Competencies | ## Tasks | ## Attendance | ## Journal
- Ayşe report as her mentor: 2519 chars, same as advisor's: true
- Ayşe week (advisor view): ["2026-09-14:present/submitted","2026-09-15:present/submitted","2026-09-16:present/submitted","2026-09-17:present/submitted","2026-09-18:present/submitted","2026-09-19:present/submitted"]
- isolation: attendance of a foreign group: refused
- outsider: Ayça Yıldız reads Ayşe's report: refused REPORT_FORBIDDEN
## Cross-person checks

- leaderboard identical across the 7 students (7 rows)
- stream count identical across the 7 students: 34
- Elif Kaya: attendance table matches the student's week (6 days, 6 logs)
- Burak Şahin: attendance table matches the student's week (3 days, 2 logs)
- Zeynep Arslan: attendance table matches the student's week (6 days, 6 logs)
- Mert Yılmaz: attendance table matches the student's week (6 days, 6 logs)
- Ayşe Çelik: attendance table matches the student's week (6 days, 6 logs)
- Can Doğan: attendance table matches the student's week (6 days, 6 logs)
- Deniz Yıldırım: attendance table matches the student's week (6 days, 6 logs)
- advisor group_assignment_counts = [{"assignment_id":"1591a485-21dd-429a-90aa-7cfd74bae804","submitted":7,"approved":6,"needs_revision":0},{"assignment_id":"1f33b091-3224-4d46-beb9-2f49ec67aa7c","submitted":7,"approved":7,"needs_revision":0},{"assignment_id":"34abb4e7-39b5-4365-8cb6-56786efe5bc5","submitted":1,"approved":1,"needs_revision":0},{"assignment_id":"45e71428-169c-44fc-b055-e5f5ea417dca","submitted":7,"approved":7,"needs_revision":0},{"assignment_id":"67247cb8-c6a4-442f-aa81-fcf6e96b7be7","submitted":5,"approved":5,"needs_revision":0},{"assignment_id":"74b964d6-219f-4437-a0c6-0f3bace226f7","submitted":0,"approved":0,"needs_revision":0},{"assignment_id":"df02d85e-1c8e-41f4-913b-91b14ab7cc65","submitted":0,"approved":0,"needs_revision":0},{"assignment_id":"e769117c-3558-4c43-a137-68d98ff834ec","submitted":0,"approved":0,"needs_revision":0}]; students' own rows: approved 26, submitted 1
- announcement comment set identical for advisor and Can: 1 comment(s)


## Screen notes

Read after the run, screen by screen, against the data above. "Filed" = an entry in `sim/bugs.md`; the rest are observations that are by design or sim artefacts.

### app/(student)/dashboard.tsx
- "This week" strip (`:80-83`, `:218-227`) marks a day only when `check_in_at` is set. 32 of 39 recorded days were late declarations (opened with a reason, `check_in_at` NULL); only Sat 19 Sep is a live check-in. Elif, Zeynep, Mert, Ayşe and Can therefore see Mon–Fri as "·" and one ✓ on Saturday, while the days screen and the mentor show six days present. **Filed [rough].**
- Day line (`:189-193`): today is 2026-09-20, every placement ends 2026-09-19 → "Staj dönemi bitti · <company>" for all seven students, including the six who are not closed. Correct given the dates the sim entered (13 Sep – 19 Sep, a Sunday-to-Saturday week); not filed.
- Week task rows (`:96-120`, last 3): the events are the `reviewed_at` timestamps, all on 19–20 Sep, so each student sees three "approved" rows with `Cmt`/`Paz` weekday labels. Fine.
- "0 of 6 at target · 132 XP · Level 2" (`:262`) — 0 at target for everyone after 26 approvals (see achievements). Part of the [rough] filed under achievements.
- `next` card: Elif/Ayşe/Can/Mert → "Pick one routine task…" (todo); Burak → "Upload, format, or merge…" (his only todo); Zeynep/Deniz → "Type a brief summary…". Titles translate except the "(revize)" one (see my-tasks).

### app/(student)/my-tasks.tsx + src/components/student/StudentUI.tsx (TaskRow)
- Tabs count from `taskState` on the student's own row (`useStudentTasks` picks the row with `student_id === me`, `assignments.ts:388-391`) — one row per student per assignment, so Burak's returned-then-resubmitted task is one row in "Bekliyor (1)". Counts agree with the mentor: Ayça's pending list = 1 = Burak's `submitted` rows.
- Five titles render in Turkish; "Set a logical workflow diagram … (revize)" renders in English because `taskContent()` matches whole fields only (`src/utils/taskContent.ts:20-23`); the card's objective/criterion still translate. **Filed [rough].**
- The 152-character titles have no `numberOfLines` (`StudentUI.tsx:107`) — they wrap, nothing truncates.
- `taskDueDate` (`studentTasks.ts:27-34`) localizes `2026-09-21` correctly.

### app/(student)/task-detail.tsx
- Burak's resubmitted task shows "Mentor notu: Kriter ölçüm belirsizliğini istiyor; tabloda yok. Ekleyip yeniden gönder." (`:276-278`) under a task that is now "waiting" — the revision note stays in `mentor_note` after resubmission. **Filed [rough].**
- Elif's first task shows "Mentor notu: tekrar" and "Sen / Mentor: yoğun destek / kısmi destek" — the re-approval overwrite already filed in phase 6; not re-filed.
- Zeynep's "Set a logical workflow diagram…" has no photo and no document; `—` appears nowhere for evidence (the sections are simply absent). The `—` placeholders (`:305`, `:313`) only apply to note/reflection, which every submission has (Burak's five identical "Yaptım." reflections were filed in phase 4).
- Murat Koç's approvals carry `mentor_note: ""` → the note block is hidden (`!!task.submission?.mentorNote`), no empty box. Fine.

### app/(student)/achievements.tsx
- Competencies tab (`:149`): every card says "Başlanmadı" (currentLevel 0) directly above a "Sen 2.0 / Mentor 2.0" bar from the approved task in that competency. The level is right per spec (2 observations × 2 KPIs per level, one task = one observation), the label is not. **Filed [rough].**
- Mert: four cards with "Sen 3.0 / Mentor 1.0" — the bars make the gap visible; the closed stamp with a localized date (`:81`) appears only for Ayşe.
- Zeynep's unshared task is still counted in her self-vs-mentor rows (sharing is a stream setting, not an assessment one). Correct.

### src/components/screens/FeedScreen.tsx + src/components/feed/FeedPostCard.tsx
- 34 posts, identical for every student and the advisor (paged at 50; the app pages at 20 → the second page is needed to reach the six `assignment` cards published at 11:26:44 on 19 Sep).
- 25 task cards = 26 approvals − Zeynep's unshared "Record measurements…" (`share_to_feed=false`). Each card carries a title (none empty), competency · L2 and the student's note; evidence is signed at read time (`feed.ts:81-104`).
- The announcement shows likes 5, comments 1 — the one surviving comment is Zeynep's "Tamam."; the advisor and Can both read exactly that set (Can's own comment, deleted in phase 7, is gone for both).
- Second announcement "Cuma günü 15:00'te grup görüşmesi yapacağız (taslak)." — the "(taslak)" suffix is the sim's draft label, published as-is in phase 7; not a defect.
- Poll: 6 votes of 7 members (Ayşe never votes — her character). `myOptionId` set for the voters.
- Card dates use `toLocaleDateString(i18n.language)` (`FeedPostCard.tsx:147`) — correct locale.
- The "(revize)" title renders in English here too (`:176`, `:242`) — same [rough] as my-tasks.

### src/components/screens/MessagesScreen.tsx + src/components/messages/ConversationList.tsx
- Can: "Konu · Can Doğan" (subtitle "Selin Aydın, Selin Kurt", unread 1), "Selin Kurt" (Mentor · ÇEV 400…), "Selin Aydın" (Danışman · ÇEV 400…). A case thread titled with the student's own name on his own list reads slightly odd but is labelled "Konu ·" (`ConversationList.tsx:19`); not filed.
- Selin Kurt (mentor): two rows both titled "Can Doğan" — distinguishable only by the "Konu ·" prefix and the subtitle. Acceptable.
- `unread_message_count` = sum of the rows' `unreadCount` for everyone (Can 1, Selin Kurt 2, others 0).
- Ayşe, Zeynep, Mert: empty list — their characters never message; the empty state is correct.

### src/components/internship/InternshipDaysScreen.tsx
- Burak (student view, "this week" = 14–20 Sep): 14/15/16 Sep show "Kayıt yok" + "Gün ekle"; 17/18 present · log submitted; 19 present · log draft ("Günlüğü yaz"). His totals: `missingLogs 1`. Reads right.
- Deniz: 16 Sep "Mazeretli" stamp with log submitted; Can: 16 Sep "Kısmi" — both approved-style stamps (`:266`); fine.
- Header period (`:246`, `:297`) is raw ISO "2026-09-13 — 2026-09-19" next to localized day labels ("Pzt 14 Eyl", `:107`). **Filed [rough].**
- Saturday 19 Sep is a recorded, present day for everyone — the week grid shows it because a record exists. The advisor's counts do not expect it (see reports).

### app/(mentor)/pending-reviews.tsx + review-detail.tsx
- Ayça: one row — "Burak Şahin / Send a direct message to a peer… / 19 Eyl 21:01 · 1 fotoğraf, 0 belge" (`:94-105`, `reviewSubmittedAt` localized). Nothing marks it as a resubmission; the old revision note is only visible on the student side. Every other mentor sees the empty state "Bekleyen inceleme yok".
- review-detail: reflection "Belirsizliği hesaplamadan tablo eksik sayılıyormuş." and self level "yoğun destek" (`:229`, `:240`). Fine.
- Mentors are refused the stream (`NOT_IN_GROUP`) and there is no feed screen in `app/(mentor)/` — by design (phase-5 controller note).

### app/(advisor)/reports.tsx
- Progress tab: "Progress · 0%" for all seven, "Gönderilen 4 (Onaylanan 4)" etc. (`:340-342`); `submitted` is the total row count (Burak 5/4). Self vs mentor: Mert "−2.0 · Kendini yüksek değerlendiriyor" (`:346-350`, `gapTag ≤ −1`); Elif/Can/Ayşe positive fractions (weighted); Zeynep/Deniz "0.0". Mert's row is the intended showcase and renders correctly.
- Attendance tab (`:362-364`): six students "6 of 5 working days recorded so far · 5 in the whole internship" (Saturday counted as recorded but not expected); Burak "3 of 5 … 2 working days without a record" although 14–16 Sep (three weekdays) have no record. **Filed [rough].** Present/partial/excused/absent counts (6/0/0/0, Can 5/1/0/0, Deniz 5/0/1/0, Burak 3/0/0/0) match every student's own week.
- Ayşe carries the "closed" stamp (`:339`); the CSV export gets the same "unrecorded" figures.

### app/(advisor)/student-monitor.tsx
- Closure card: Ayşe "Kapatıldı 20.09.2026" (`:227`, localized), reportVersion 2; Burak "1 inceleme bekliyor" (`pendingReviewsMessage`, `:223`) which is the real blocker for closing him; the other five show the close action.
- Progress per student is the same 0/2 … 0/3 rows as the student sees (`get_competency_progress` identical for student, mentor and advisor — checked for all seven).

### src/components/screens/InternshipReportScreen.tsx
- Renders `get_internship_report` markdown through `MarkdownView` (`:113`). The deployed function's literals are mojibake: title "# Internship report ÔÇö Ayşe Çelik", "2026-09-13 ÔÇô 2026-09-19", empty cells "ÔÇö", "Submitted journals: 6 ┬À Support levels…". The SQL source (`docs/internship-closure-migration.sql:99`) is correct, so the body was applied with the wrong encoding. Same text for advisor, student and mentor; version 2. **Filed [wrong].**
- Content otherwise consistent with the screens: 4 approved tasks (self/mentor as "partial support" etc.), 2 not started, attendance 5 working days / 6 recorded / 6 present, journals 6 (heavy 3 · partial 3) = Ayşe's `support_level` 1,1,1,2,2,2. No reflection or note text (checked in phase 7).
- "Closed | 2026-09-20 13:22 UTC" — UTC on a Turkish report; covered by the ISO-date [rough].

### app/(student)/notifications.tsx (notificationContent)
- All server titles map to Turkish (`src/utils/notificationContent.ts`): "Yeni duyuru", "Yeni mesaj", "Konu görüşmesi açıldı", "Yeni gelişim aşaması!", "Staj günün için geri bildirim", "Katılım durumu belirlendi", "Rozet kazandın!", "Staj tamamlandı / yeniden açıldı".
- "Katılım durumu belirlendi" bodies carry a reversed range for 5 of 7 students — "6 gün için katılım durumu: katıldı (2026-09-17 – 2026-09-14)" (Mert), "(2026-09-19 – 2026-09-16)" (Ayşe), "(2026-09-15 – 2026-09-18)" (Elif, six days). `internship_review` takes first/last in uuid order. **Filed [wrong].**
- Burak's "Görev hatırlatması" (type `general`, Turkish title written by the advisor in phase 7) passes through untouched. No `task_approved` for anyone (filed in phase 6).
- Mentors: Oğuz has 7 `internship_log_submitted` for 6 days (Deniz's correction resubmission) and Ayça 6 `task_submitted` for 5 rows (Burak's resubmission) — each an event, consistent.
