# ayca-yildiz

- `11:55:57` **auth.signUp** {"email":"ayca.yildiz@sim.engineertrack.test","role":"mentor"} → 3a1e5820-0939-4b03-8060-cde6abcdc056
- `11:55:57` **link_student_by_code** {"p_code":"ABC123","p_role":"mentor"} → **ERROR** INVALID_CODE
- _11:55:57_ expected refusal INVALID_CODE for: link with a made-up code
- `11:55:57` **link_student_by_code** {"p_code":"JKPDHG","p_role":"mentor"} → [{"student_id":"99a265a1-eb47-4e4c-95d0-beee40653f71","student_name":"Burak Şahin"}]
- _11:55:57_ link_student_by_code → [{"student_id":"99a265a1-eb47-4e4c-95d0-beee40653f71","student_name":"Burak Şahin"}] (an ARRAY of one row {student_id, student_name} — RETURNS TABLE; adaptation #2)
- `11:55:57` **internship_people** {} → [{"id":"99a265a1-eb47-4e4c-95d0-beee40653f71","name":"Burak Şahin","company":"Ege Çevre Danışmanlık","endDate":"2026-09-19","mentorId":"3a1e5820-0939-4b03-80…
- _11:55:57_ internship_people → 1 student(s); Burak is listed.
- `11:55:57` **link_student_by_code** {"p_code":"8N2TXF","p_role":"mentor"} → [{"student_id":"5d9c97c7-b804-4a65-890d-7eb65270f2ca","student_name":"Elif Kaya"}]
- _11:55:57_ Second-mentor probe: linking Elif's code (8N2TXF, already mentored by Hakan Demir) → SUCCEEDED: [{"student_id":"5d9c97c7-b804-4a65-890d-7eb65270f2ca","student_name":"Elif Kaya"}]. Unexpected — the domain model says a student has one mentor.
- `11:55:57` **internship_people** {} → [{"id":"99a265a1-eb47-4e4c-95d0-beee40653f71","name":"Burak Şahin","company":"Ege Çevre Danışmanlık","endDate":"2026-09-19","mentorId":"3a1e5820-0939-4b03-80…
- `11:55:57` **table.student_profiles.select** {} → {"id":"5d9c97c7-b804-4a65-890d-7eb65270f2ca","mentor_id":"3a1e5820-0939-4b03-8060-cde6abcdc056"}
- _11:55:57_ BUG [wrong] link a second mentor (myself) onto Elif, who already has a mentor (Hakan Demir) — got link_student_by_code succeeded: [{"student_id":"5d9c97c7-b804-4a65-890d-7eb65270f2ca","student_name":"Elif Kaya"}]; internship_people → [{"id":"99a265a1-eb47-4e4c-95d0-beee40653f71","name":"Burak Şahin","company":"Ege Çevre Danışmanlık","endDate":"2026-09-19","mentorId":"3a1e5820-0939-4b03-8060-cde6abcdc056","startDate":"2026-09-13"},{"id":"5d9c97c7-b804-4a65-890d-7eb65270f2ca","name":"Elif Kaya","company":"Marmara Su ve Kanalizasyon İdaresi","endDate":"2026-09-19","mentorId":"3a1e5820-0939-4b03-8060-cde6abcdc056","startDate":"2026-09-13"}]; student_profiles(Elif) → {"id":"5d9c97c7-b804-4a65-890d-7eb65270f2ca","mentor_id":"3a1e5820-0939-4b03-8060-cde6abcdc056"}
- `11:55:57` **table.assignment_submissions.select** {} → []
- `11:55:57` **list_mentor_message_contacts** {} → [{"id":"f6f7070c-b697-4bbe-8b3b-0a65d579a132","name":"Selin Aydın","role":"advisor","groupId":"861d35d8-5083-4146-a8eb-38b10b5a0640","groupName":"ÇEV 400 Sta…
- _11:55:57_ list_mentor_message_contacts → Burak is listed alongside the advisor.
- _11:55:57_ Faz 3 bitti. Sıkı bir mentor olarak: Burak'ı bağladım, Elif'in kodunu da denedim (ikinci mentor kontrolü). Sonucu kayıt altına aldım.
