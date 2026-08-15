-- Remove only the sample records shipped with the original demo.
-- Real congregation records and administrator accounts are not affected.

delete from public.members
where email in (
  'emmanuel.addo@example.com',
  'grace.asare@example.com',
  'akua.mensah@example.com'
);

delete from public.transactions
where (transaction_date, description, amount) in (
  ('2026-08-09'::date, 'Sunday service offering', 6850::numeric),
  ('2026-08-08'::date, 'Monthly tithe', 4200::numeric),
  ('2026-08-06'::date, 'Church utilities', 1380::numeric)
);

delete from public.events
where (title, event_date) in (
  ('Sunday Worship Service', '2026-08-16'::date),
  ('Session Meeting', '2026-08-18'::date),
  ('Community Health Outreach', '2026-08-22'::date)
);
