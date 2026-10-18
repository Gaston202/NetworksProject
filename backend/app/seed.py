"""Demo seed data — idempotent: skips if the seed is complete, detects and
heals a partially-written seed (a mid-seed failure used to be misreported as
"already present" because only the admin row was checked).

Run:  .venv/Scripts/python -m app.seed        (from the backend/ directory)
Accounts and password come from SEED_PASSWORD in .env (default: hms-demo-1234).

Three-role scope (ADR-0007): admin, doctor, patient. No nurse/pharmacist/meds.
Atlas is the only database (ADR-0004): indexes are ensured here and at app
startup; there is no schema/migration step.

The world is "Carthage Medical Center" with two weeks of history: completed
visits (consultation + invoice, mostly paid), cancellations, and upcoming
bookings. Generation uses a fixed RNG seed, so a reset always rebuilds the
same hospital relative to today's date. The scripted demo accounts
(docs/demo-walkthrough.md) are unchanged, and Dr. Haddad keeps most of her
week free so Act 1 always has slots to book.
"""
import asyncio
import random
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

from app.core.config import settings
from app.core.security import hash_password
from app.db.indexes import ensure_indexes
from app.db.mongo import date_to_dt, db, reserve_ids, utcnow
from app.domain import AppointmentStatus, InvoiceStatus, UserRole

RNG_SEED = 411  # CS411 — any fixed value keeps resets reproducible

DEPARTMENTS = [
    "Cardiology", "Pediatrics", "General Medicine",
    "Dermatology", "Orthopedics", "ENT",
]

# Order matters: the e2e smoke test books the FIRST Cardiology doctor.
DOCTORS = [
    ("Dr. Amina Haddad", "amina.haddad@hms.example.com", "Cardiology", "Interventional cardiology"),
    ("Dr. Omar Benali", "omar.benali@hms.example.com", "Cardiology", "General cardiology"),
    ("Dr. Salma Trabelsi", "salma.trabelsi@hms.example.com", "Pediatrics", "Neonatal care"),
    ("Dr. Youssef Gharbi", "youssef.gharbi@hms.example.com", "General Medicine", "Family medicine"),
    ("Dr. Hichem Riahi", "hichem.riahi@hms.example.com", "General Medicine", "Internal medicine"),
    ("Dr. Nour Ben Salah", "nour.bensalah@hms.example.com", "Dermatology", "Clinical dermatology"),
    ("Dr. Karim Jaziri", "karim.jaziri@hms.example.com", "Orthopedics", "Sports injuries"),
    ("Dr. Ines Chaabane", "ines.chaabane@hms.example.com", "ENT", "Otolaryngology"),
]
DEMO_DOCTOR_EMAIL = DOCTORS[0][1]

STAFF = [
    ("Ghassen Admin", "admin@hms.example.com", UserRole.ADMIN),
]

# (name, email, date of birth, phone, address). The first two are the
# scripted demo patients.
PATIENTS = [
    ("Sami Patient", "patient@hms.example.com", date(1991, 4, 12), "+216 55 214 870", "12 Rue de Marseille, Tunis"),
    ("Leila Mansour", "leila.mansour@hms.example.com", date(1987, 9, 3), "+216 98 330 115", "4 Avenue Habib Bourguiba, La Marsa"),
    ("Mehdi Karoui", "mehdi.karoui@mail.example.com", date(1979, 1, 22), "+216 22 640 391", "27 Rue Ibn Khaldoun, Ariana"),
    ("Rania Bouazizi", "rania.bouazizi@mail.example.com", date(1995, 6, 30), "+216 50 118 902", "8 Rue de Carthage, Le Kram"),
    ("Anis Ferchichi", "anis.ferchichi@mail.example.com", date(1968, 11, 5), "+216 97 455 210", "33 Avenue de la Liberté, Tunis"),
    ("Hela Zouari", "hela.zouari@mail.example.com", date(2001, 2, 14), "+216 26 903 774", "2 Rue Hannibal, Carthage"),
    ("Walid Mejri", "walid.mejri@mail.example.com", date(1983, 8, 9), "+216 53 772 146", "15 Rue Tarek Ibn Ziad, Bardo"),
    ("Sonia Hammami", "sonia.hammami@mail.example.com", date(1974, 12, 19), "+216 92 281 607", "41 Avenue Mohamed V, Tunis"),
    ("Fares Belhadj", "fares.belhadj@mail.example.com", date(2015, 5, 2), "+216 24 516 330", "9 Rue des Jasmins, Ben Arous"),
    ("Yasmine Khelifi", "yasmine.khelifi@mail.example.com", date(1998, 3, 27), "+216 58 049 812", "6 Rue Salammbô, Carthage"),
    ("Nabil Sassi", "nabil.sassi@mail.example.com", date(1959, 10, 11), "+216 98 627 554", "20 Rue de Rome, Tunis"),
    ("Imen Dridi", "imen.dridi@mail.example.com", date(1990, 7, 8), "+216 21 735 048", "11 Avenue de Paris, Tunis"),
    ("Aziz Ayari", "aziz.ayari@mail.example.com", date(2018, 9, 16), "+216 55 862 471", "3 Rue Elyssa, La Goulette"),
    ("Mariem Jlassi", "mariem.jlassi@mail.example.com", date(1985, 4, 23), "+216 99 304 668", "18 Rue de Palestine, Tunis"),
    ("Tarek Bouslama", "tarek.bouslama@mail.example.com", date(1971, 2, 1), "+216 23 190 485", "52 Avenue Taieb Mhiri, Ariana"),
    ("Olfa Guesmi", "olfa.guesmi@mail.example.com", date(1993, 11, 29), "+216 51 667 203", "7 Rue Magon, Carthage"),
    ("Bilel Nasri", "bilel.nasri@mail.example.com", date(1980, 6, 17), "+216 96 418 739", "25 Rue d'Alger, Tunis"),
    ("Asma Chebbi", "asma.chebbi@mail.example.com", date(2009, 1, 9), "+216 27 553 960", "14 Rue Ibn Rochd, Manouba"),
    ("Khaled Mabrouk", "khaled.mabrouk@mail.example.com", date(1964, 3, 4), "+216 52 836 117", "30 Avenue de France, Tunis"),
    ("Dorra Hamdi", "dorra.hamdi@mail.example.com", date(1997, 8, 21), "+216 94 702 385", "5 Rue Byrsa, Carthage"),
]
DEMO_PATIENT_EMAIL = PATIENTS[0][1]

# Realistic visit notes per department: (diagnosis, notes, prescription).
CASES: dict[str, list[tuple[str, str, str | None]]] = {
    "Cardiology": [
        ("Essential hypertension", "BP 152/94 on two readings. Lifestyle advice given; review in 4 weeks.",
         "Amlodipine 5 mg, 1x daily, 30 days"),
        ("Palpitations, benign", "ECG normal sinus rhythm. Advised to reduce caffeine.", None),
        ("Stable angina", "Exertional chest tightness, resolves with rest. Stress test requested.",
         "Aspirin 75 mg 1x daily; Nitroglycerin spray as needed"),
        ("Hypercholesterolemia", "LDL 4.6 mmol/L. Diet counselling.", "Atorvastatin 20 mg, 1x daily at night"),
    ],
    "Pediatrics": [
        ("Acute otitis media", "Right ear bulging tympanic membrane, fever 38.6 °C.",
         "Amoxicillin 50 mg/kg/day in 2 doses, 7 days"),
        ("Viral gastroenteritis", "Mild dehydration. Oral rehydration explained to parents.",
         "ORS sachets after each loose stool"),
        ("Routine growth check", "Weight and height on the 50th percentile. Vaccines up to date.", None),
    ],
    "General Medicine": [
        ("Upper respiratory tract infection", "Sore throat, no exudate, afebrile.",
         "Paracetamol 1 g up to 3x daily, 5 days"),
        ("Type 2 diabetes follow-up", "HbA1c 7.4 %. Foot exam normal.", "Metformin 850 mg, 2x daily"),
        ("Low back pain, mechanical", "No red flags. Physiotherapy advised.", "Ibuprofen 400 mg, 3x daily with food, 5 days"),
        ("Seasonal allergic rhinitis", "Sneezing and itchy eyes since March.", "Cetirizine 10 mg, 1x daily"),
    ],
    "Dermatology": [
        ("Atopic dermatitis", "Flexural eczema, moderate. Emollients daily.",
         "Hydrocortisone 1 % cream, 2x daily, 7 days"),
        ("Acne vulgaris", "Comedonal and papular lesions on the forehead.", "Adapalene 0.1 % gel at night"),
        ("Benign naevus", "Dermoscopy reassuring. Annual review.", None),
    ],
    "Orthopedics": [
        ("Ankle sprain, grade I", "Lateral ligament tenderness, stable joint. RICE protocol.",
         "Ibuprofen 400 mg, 3x daily, 5 days"),
        ("Patellofemoral pain syndrome", "Anterior knee pain on stairs. Strengthening programme.", None),
        ("Rotator cuff tendinopathy", "Painful arc 60-120°. Ultrasound requested.", "Diclofenac gel, 3x daily"),
    ],
    "ENT": [
        ("Acute sinusitis", "Facial pressure and purulent discharge for 10 days.",
         "Amoxicillin-clavulanate 1 g, 2x daily, 7 days"),
        ("Earwax impaction", "Bilateral cerumen removed by irrigation.", None),
        ("Tonsillitis", "Exudative tonsils, tender nodes.", "Penicillin V 1 MIU, 3x daily, 10 days"),
    ],
}

# Slot windows per day (start hour, hours): 09:00-12:00 and 14:00-16:00,
# 30-minute slots.
SLOT_WINDOWS = ((9, 3), (14, 2))
SLOT_MINUTES = 30
HISTORY_DAYS = 14      # past days with visit history (Sundays closed)
UPCOMING_DAYS = 7      # today + 6 days of bookable slots

# Booking probabilities per slot.
PAST_BOOKED_RATE = 0.3
PAST_CANCELLED_RATE = 0.08    # share of past bookings that were cancelled
PAID_RATE = 0.85              # share of past invoices already settled
UPCOMING_BOOKED_RATE = 0.3
DEMO_DOCTOR_UPCOMING_RATE = 0.12   # keeps Act 1's doctor mostly free


@dataclass
class SeedPlan:
    """Everything the seed inserts, built in memory first so a run is all-or-nothing
    up to the inserts and the partial-seed check knows the expected counts."""
    collections: dict[str, list[dict]] = field(default_factory=dict)

    def counts(self) -> dict[str, int]:
        return {name: len(docs) for name, docs in self.collections.items()}


def _user_doc(_id: int, full_name: str, email: str, password_hash: str,
              role: str, created_at: datetime) -> dict:
    return {
        "_id": _id,
        "full_name": full_name,
        "email": email,
        "password_hash": password_hash,
        "role": role,
        "is_active": True,
        "created_at": created_at,
    }


def _day_slots(day: datetime) -> list[tuple[datetime, datetime]]:
    starts = [
        day + timedelta(hours=start_hour, minutes=SLOT_MINUTES * index)
        for start_hour, hours in SLOT_WINDOWS
        for index in range(hours * 60 // SLOT_MINUTES)
    ]
    return [(start, start + timedelta(minutes=SLOT_MINUTES)) for start in starts]


async def build_plan(password_hash: str, now: datetime) -> SeedPlan:
    """Reserve ids and assemble every document. `now` is local wall-clock time,
    the same clock the slot endpoints use (naive datetimes)."""
    rng = random.Random(RNG_SEED)
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    plan = SeedPlan()

    dept_ids = await reserve_ids("departments", len(DEPARTMENTS))
    departments = [{"_id": _id, "name": name} for _id, name in zip(dept_ids, DEPARTMENTS)]
    dept_id_by_name = {d["name"]: d["_id"] for d in departments}

    def joined(days_ago_min: int, days_ago_max: int) -> datetime:
        return utcnow() - timedelta(days=rng.randint(days_ago_min, days_ago_max),
                                    minutes=rng.randint(0, 600))

    user_ids = iter(await reserve_ids("users", len(STAFF) + len(DOCTORS) + len(PATIENTS)))
    staff_users = [
        _user_doc(next(user_ids), name, email, password_hash, role.value, joined(300, 400))
        for name, email, role in STAFF
    ]
    doctor_users = [
        _user_doc(next(user_ids), name, email, password_hash, UserRole.DOCTOR.value, joined(200, 300))
        for name, email, _, _ in DOCTORS
    ]
    patient_users = [
        _user_doc(next(user_ids), name, email, password_hash, UserRole.PATIENT.value, joined(20, 180))
        for name, email, *_ in PATIENTS
    ]

    doctor_profile_ids = await reserve_ids("doctor_profiles", len(DOCTORS))
    doctor_profiles = [
        {"_id": profile_id, "user_id": user["_id"],
         "department_id": dept_id_by_name[dept], "specialty": specialty}
        for profile_id, user, (_, _, dept, specialty)
        in zip(doctor_profile_ids, doctor_users, DOCTORS)
    ]
    patient_profile_ids = await reserve_ids("patient_profiles", len(PATIENTS))
    patient_profiles = [
        {"_id": profile_id, "user_id": user["_id"], "date_of_birth": date_to_dt(dob),
         "phone": phone, "address": address}
        for profile_id, user, (_, _, dob, phone, address)
        in zip(patient_profile_ids, patient_users, PATIENTS)
    ]

    # --- Slots: HISTORY_DAYS back (Sundays closed) through UPCOMING_DAYS ahead.
    # Upcoming days stay open every day so any doctor is bookable in the demo.
    slot_windows: list[tuple[dict, datetime, datetime]] = []
    for offset in range(-HISTORY_DAYS, UPCOMING_DAYS):
        day = today + timedelta(days=offset)
        if offset < 0 and day.weekday() == 6:
            continue
        for profile in doctor_profiles:
            for start, end in _day_slots(day):
                slot_windows.append((profile, start, end))
    slot_ids = await reserve_ids("availability_slots", len(slot_windows))
    slots = [
        {"_id": slot_id, "doctor_id": profile["_id"], "starts_at": start, "ends_at": end}
        for slot_id, (profile, start, end) in zip(slot_ids, slot_windows)
    ]

    # --- Appointments over those slots.
    dept_name_by_doctor = {
        profile["_id"]: DOCTORS[index][2] for index, profile in enumerate(doctor_profiles)}
    demo_doctor_id = doctor_profiles[0]["_id"]
    demo_patient_id = patient_profiles[0]["_id"]
    pediatric_patients = [  # under 16 on the seed date
        p["_id"] for p, (_, _, dob, _, _) in zip(patient_profiles, PATIENTS)
        if (today.date() - dob).days < 16 * 365]
    adult_patients = [p["_id"] for p in patient_profiles if p["_id"] not in pediatric_patients]

    drafts: list[tuple[dict, int]] = []   # (slot, patient profile id)
    for slot in slots:
        doctor_id = slot["doctor_id"]
        is_past = slot["starts_at"] < now
        if is_past:
            rate = PAST_BOOKED_RATE
        elif doctor_id == demo_doctor_id:
            rate = DEMO_DOCTOR_UPCOMING_RATE
        else:
            rate = UPCOMING_BOOKED_RATE
        if rng.random() >= rate:
            continue
        pool = (pediatric_patients if dept_name_by_doctor[doctor_id] == "Pediatrics"
                else adult_patients)
        drafts.append((slot, rng.choice(pool)))

    # Demo patient history: guarantee one paid and one unpaid past visit and
    # one upcoming visit outside Dr. Haddad's calendar, so their dashboard,
    # records and invoices are never empty.
    booked_slot_ids = {slot["_id"] for slot, _ in drafts}
    gp_ids = {p["_id"] for p, d in zip(doctor_profiles, DOCTORS) if d[2] == "General Medicine"}
    free_gp_past = [s for s in slots if s["doctor_id"] in gp_ids and s["starts_at"] < now - timedelta(days=2)
                    and s["_id"] not in booked_slot_ids]
    free_gp_future = [s for s in slots if s["doctor_id"] in gp_ids and s["starts_at"] > now + timedelta(days=1)
                      and s["_id"] not in booked_slot_ids]
    demo_past = [free_gp_past[len(free_gp_past) // 4], free_gp_past[-1]]
    demo_future = free_gp_future[len(free_gp_future) // 3]
    drafts += [(slot, demo_patient_id) for slot in (*demo_past, demo_future)]
    forced_unpaid_slot = demo_past[1]["_id"]
    forced_completed = {slot["_id"] for slot in demo_past}

    appointment_ids = iter(await reserve_ids("appointments", len(drafts)))
    appointments: list[dict] = []
    invoices_pending: list[dict] = []
    for slot, patient_id in sorted(drafts, key=lambda d: d[0]["starts_at"]):
        start, end = slot["starts_at"], slot["ends_at"]
        appointment = {
            "_id": next(appointment_ids),
            "slot_id": slot["_id"],
            "patient_id": patient_id,
            "doctor_id": slot["doctor_id"],
            "status": AppointmentStatus.BOOKED.value,
            "starts_at": start,
            "ends_at": end,
            "created_at": start - timedelta(days=rng.randint(1, 10), hours=rng.randint(1, 8)),
        }
        if start < now:
            if slot["_id"] not in forced_completed and rng.random() < PAST_CANCELLED_RATE:
                appointment["status"] = AppointmentStatus.CANCELLED.value
                appointment["original_slot_id"] = appointment.pop("slot_id")
            elif end <= now:
                diagnosis, notes, prescription = rng.choice(
                    CASES[dept_name_by_doctor[slot["doctor_id"]]])
                appointment["status"] = AppointmentStatus.COMPLETED.value
                appointment["consultation"] = {
                    "diagnosis": diagnosis,
                    "notes": notes,
                    "prescription": prescription,
                    "created_at": start + timedelta(minutes=rng.randint(15, 25)),
                }
                paid = slot["_id"] != forced_unpaid_slot and (
                    slot["_id"] in forced_completed or rng.random() < PAID_RATE)
                invoices_pending.append({
                    "appointment_id": appointment["_id"],
                    "patient_id": patient_id,   # internal; not in InvoiceOut
                    "total": settings.consultation_fee,
                    "status": (InvoiceStatus.PAID if paid else InvoiceStatus.UNPAID).value,
                    "created_at": end,
                })
        appointments.append(appointment)

    invoice_ids = await reserve_ids("invoices", len(invoices_pending))
    invoices = [{"_id": _id, **doc} for _id, doc in zip(invoice_ids, invoices_pending)]

    plan.collections = {
        "departments": departments,
        "users": staff_users + doctor_users + patient_users,
        "doctor_profiles": doctor_profiles,
        "patient_profiles": patient_profiles,
        "availability_slots": slots,
        "appointments": appointments,
        "invoices": invoices,
    }
    return plan


# Minimum counts that a complete seed always reaches (appointments/invoices
# depend on the date, so only the fixed collections are checked).
SEED_MINIMUMS = {
    "users": len(STAFF) + len(DOCTORS) + len(PATIENTS),
    "departments": len(DEPARTMENTS),
    "doctor_profiles": len(DOCTORS),
    "patient_profiles": len(PATIENTS),
}
SEEDED_COLLECTIONS = [*SEED_MINIMUMS, "availability_slots", "appointments", "invoices"]


async def seed() -> None:
    await ensure_indexes(db)
    if await db["users"].find_one({"email": "admin@hms.example.com"}):
        # A legit install only ever GROWS these counts (no deletion endpoints
        # for the seeded rows), so anything below the seed minimum means a
        # mid-seed failure — reset the seeded collections and redo it fully.
        partial = []
        for name, expected in SEED_MINIMUMS.items():
            count = await db[name].count_documents({})
            if count < expected:
                partial.append(f"{name}: {count} < {expected}")
        if partial:
            print("Partial seed detected - resetting and re-seeding:")
            print(f"    {', '.join(partial)}")
            for name in [*SEEDED_COLLECTIONS, "counters"]:
                await db[name].drop()
            await ensure_indexes(db)
        else:
            print("Seed data already present - nothing to do.")
            return

    plan = await build_plan(hash_password(settings.seed_password), datetime.now())
    for name, docs in plan.collections.items():
        if docs:
            await db[name].insert_many(docs)

    counts = plan.counts()
    paid = sum(1 for inv in plan.collections["invoices"] if inv["status"] == InvoiceStatus.PAID.value)
    print(f"Seeded Carthage Medical Center: {counts['departments']} departments, "
          f"{len(STAFF) + len(DOCTORS)} staff, {len(PATIENTS)} patients, "
          f"{counts['availability_slots']} slots, {counts['appointments']} appointments, "
          f"{counts['invoices']} invoices ({paid} paid; fee {settings.consultation_fee})")
    print(f"Demo password for every seeded account: {settings.seed_password}")


if __name__ == "__main__":
    asyncio.run(seed())
