# gamze-ozturk

- `11:55:39` **auth.signUp** {"email":"gamze.ozturk@sim.engineertrack.test","role":"mentor"} → 02ab2d3e-1e39-456a-a4d1-74b3bd1caf0e
- `11:55:40` **link_student_by_code** {"p_code":"ABC123","p_role":"mentor"} → **ERROR** INVALID_CODE
- _11:55:40_ expected refusal INVALID_CODE for: link with a made-up code
- `11:55:40` **link_student_by_code** {"p_code":"S4KGPF","p_role":"mentor"} → [{"student_id":"c7ad72a5-5cbd-40e0-8ac3-daeb3bea7d2b","student_name":"Mert Yılmaz"}]
- _11:55:40_ link_student_by_code → [{"student_id":"c7ad72a5-5cbd-40e0-8ac3-daeb3bea7d2b","student_name":"Mert Yılmaz"}] (array of one row {student_id, student_name} — RETURNS TABLE, per task-6a-report.md)
- `11:55:40` **internship_people** {} → [{"id":"c7ad72a5-5cbd-40e0-8ac3-daeb3bea7d2b","name":"Mert Yılmaz","company":"İzmir Atık Yönetimi A.Ş.","endDate":"2026-09-19","mentorId":"02ab2d3e-1e39-456a…
- _11:55:40_ internship_people → 1 student(s); mine (Mert) is listed.
- `11:55:40` **table.assignment_submissions.select** {} → []
- `11:55:40` **list_mentor_message_contacts** {} → [{"id":"f6f7070c-b697-4bbe-8b3b-0a65d579a132","name":"Selin Aydın","role":"advisor","groupId":"861d35d8-5083-4146-a8eb-38b10b5a0640","groupName":"ÇEV 400 Sta…
- _11:55:40_ list_mentor_message_contacts → 2 contact(s); Mert is listed.
- _11:55:40_ Faz 3 bitti. Mert kendini her konuda 3 (bağımsız) olarak değerlendiriyor ama ben katılmıyorum — inceleme aşamasında neden düşük puan verdiğimi yazacağım.
