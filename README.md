# Buget Pro - Supabase + Vercel

Aplicație web pentru buget personal, optimizată pentru telefon și desktop.

## Ce include
- autentificare reală cu Supabase
- tranzacții venit / cheltuială
- categorii personalizate
- bugete lunare
- obiectiv de economii
- rapoarte CSV + PDF
- instalare ca aplicație pe telefon (PWA)
- PIN local suplimentar
- insight-uri smart și alerte de depășire buget

## Pornire locală
1. Instalează Node.js 20+
2. Deschide folderul proiectului
3. Rulează:
   - `npm install`
   - copiază `.env.example` în `.env`
   - completează valorile Supabase
   - `npm run dev`

## Deploy pe Vercel
1. Urcă proiectul pe GitHub
2. Intră în Vercel și alege **New Project**
3. Importă repository-ul
4. Adaugă variabilele de mediu:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
5. Apasă **Deploy**

## Setup Supabase
1. Creează proiect nou în Supabase
2. Deschide SQL Editor
3. Rulează fișierul `supabase/schema.sql`
4. În Authentication > Providers lasă Email activ
5. Ia URL-ul proiectului și cheia anon publică din Settings > API

## Observații
- PIN-ul este local pe dispozitiv și completează securitatea contului
- PWA-ul poate fi instalat din browser pe telefon după deploy
- Pentru iconițe personalizate poți înlocui fișierele din `public/`
