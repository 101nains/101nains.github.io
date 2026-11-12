/* ==========================================================================
   DATA.JS — Configuration, constantes métier & traductions
   ========================================================================== */

const SUPABASE_URL="https://kmbefvfxujfdipsbqyla.supabase.co";
const SUPABASE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImttYmVmdmZ4dWpmZGlwc2JxeWxhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQyNzczOTksImV4cCI6MjA5OTg1MzM5OX0.zop6DDlF49ms1-4a12WKWbU_X-ccPLG_D97r0Yya0Bs";

const ALLIANCE_NAME_KEY='alliance_display_name';

const TDD_NON_RETENUS_CONFIG_KEY = 'tdd_non_retenus';   // mode asymétrique (grosse équipe A + petite équipe B)
let _evSaving=false;    // true pendant saveEvTeamsToDB pour ignorer le realtime
let evAsymSizeA=25;     // nombre de joueurs dans la grosse équipe A
let evElPriority=true; // les joueurs les plus forts vont en Électrons libres en premier
let evFairRotation=(()=>{try{return localStorage.getItem('tdd_fair_rotation')==='1';}catch(e){return false;}})();

const TDD_FAIR_ROTATION_KEY='tdd_fair_rotation_stats';

const DAYS=['Lu','Ma','Me','Je','Ve'];

const DAYS_LABELS_WEEK=['Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi','Dimanche'];

const SESSION_KEY='tirage_session';

const SESSION_DURATION_DAYS=30;

const THEME_KEY='tirage_theme';

const PERM_SECTIONS=[
  {id:'secTirage',      label:'Tirage',        icon:'🚂'},
  {id:'secHist',        label:'Historique',    icon:'📋'},
  {id:'sectionParticipants', label:'Participants', icon:'👥'},
  {id:'sectionStats',   label:'Statistiques',  icon:'📊'},
  {id:'secEvents',      label:'Événements',    icon:'⚔️'},
  {id:'secCanyon',      label:'Canyon',        icon:'🏜️'},
  {id:'secArchive',     label:'Archives',      icon:'📦'},
  {id:'secRewards',     label:'Récompenses',    icon:'🏆'},
  {id:'secMovements', label:'Recrutements & Départs', icon:'🤝'},
  {id:'aboutSection',   label:'À propos',      icon:'ℹ️'},
];

const DEFAULT_PERM={
  staff: {secTirage:true,secHist:true,sectionParticipants:true,sectionStats:true,secEvents:true,secArchive:true,secCanyon:true},
  member:{secTirage:true,secHist:true,sectionParticipants:false,sectionStats:false,secEvents:true,secArchive:true,secCanyon:true}
};

const POLL_ROLE_MAP = { present:'starter', remplacant:'sub', absent:'none' };

const POLL_ICONS = { present:'✅', remplacant:'🔄', absent:'❌' };

const canyonPollIcons={present:'✅',remplacant:'🔄',absent:'❌'};

const CHART_AXES = {
  x: [
    {key:'players', label:'Joueurs', desc:'Un point par joueur'},
  ],
  y: [
    {key:'power_t1', label:'Puissance T1', group:'Puissance'},
  ],
};

const CHART_TYPES = [
  {key:'bar',    label:'Barres',  icon:'▬'},
  {key:'hbar',   label:'Barres horizontales', icon:'▭'},
];

const CHART_FILTERS = [
  {key:'all',      label:'Tous les joueurs'},
  {key:'staff',    label:'Staff uniquement (⭐)'},
  {key:'members',  label:'Membres uniquement'},
  {key:'eligible', label:'Éligibles uniquement'},
];

const CHART_COLORS = [
  '#7C9FFF','#4FD1A5','#FFB84D','#FF6B6B','#B78AFF',
  '#4FD1E8','#FF9F7A','#A8E6CF','#FFD3A3','#C3A6FF'
];

const POLL_LABELS = {present:'✅ Présent', remplacant:'🔄 Remplaçant', absent:'❌ Absent'};

const CANYON_STARTERS_PER_TEAM = 20;

const CANYON_SUBS_PER_TEAM = 10;

const CATEGORIES=[
  {key:'H1',label:'H1',size:3,color:'#7c9fff',bg:'rgba(124,159,255,0.08)'},
  {key:'H2',label:'H2',size:3,color:'#7c9fff',bg:'rgba(124,159,255,0.08)'},
  {key:'H3',label:'H3',size:3,color:'#b48eff',bg:'rgba(180,142,255,0.08)'},
  {key:'H4',label:'H4',size:3,color:'#b48eff',bg:'rgba(180,142,255,0.08)'},
  {key:'R1',label:'R1',size:2,color:'#50e898',bg:'rgba(80,232,152,0.08)'},
  {key:'R2',label:'R2',size:2,color:'#50e898',bg:'rgba(80,232,152,0.08)'},
  {key:'EL',label:'Électrons libres',size:4,color:'#ffb84d',bg:'rgba(255,184,77,0.08)'},
  {key:'SUB',label:'Remplaçants',size:10,color:'#4a4870',bg:'rgba(74,72,112,0.08)'},
];

const STARTER_CATS=['H1','H2','H3','H4','R1','R2','EL'];

const TOTAL_STARTERS=20,TOTAL_SUBS=10;

const pollTranslations={
'Recensement Puissance T1':'T1 Power Survey',
'Pour déclarer ta puissance T1, ajoute une capture d’écran de ton équipe. La puissance sera reconnue automatiquement. Une seule déclaration par joueur et par recensement.':'To report your T1 power, upload a screenshot of your team. Power will be detected automatically. One submission per player per survey.',
'Chargement du recensement…':'Loading survey…',
'Aucun recensement ouvert. Reviens à la prochaine session.':'No survey is currently open. Please come back for the next session.',
'Ton pseudo':'Your player name','Chargement…':'Loading…','Exemple de capture attendue':'Example screenshot',
'Prends une capture de l’écran de formation de ton équipe T1, avec ':'Take a screenshot of your T1 team formation screen, with ',
'la puissance totale bien visible en haut':'the total power clearly visible at the top',
' (ici : ':' (here: ','). Voici un exemple :':'). Here is an example:',
'L’image sert uniquement d’exemple : ajoute ta propre capture pour déclarer ta puissance.':'This image is only an example. Upload your own screenshot to report your power.',
'Ajouter une capture d’écran':'Upload a screenshot',
'📷 Choisir une capture de ton équipe T1 (JPG / PNG / WEBP, max 5 Mo)':'📷 Choose a screenshot of your T1 team (JPG / PNG / WEBP, max 5 MB)',
'Le site remplit automatiquement la puissance détectée. Vérifie-la et corrige-la si nécessaire avant de valider. La capture reste obligatoire.':'Detected power is filled in automatically. Check and correct it if needed before submitting. A screenshot is still required.',
'⚡ Puissance T1 détectée (modifiable)':'⚡ Detected T1 power (editable)',
'Valeur remplie après lecture de la capture. Tu peux la corriger manuellement (ex. 18.31, 18,31 ou 18.31M).':'Filled in after scanning the screenshot. You can edit it manually (e.g. 51.00M).',
'✓ Valider ma puissance T1':'✓ Submit my T1 power',
'Puissance enregistrée !':'Power saved!',
'Ta déclaration est verrouillée. Contacte le staff pour toute correction.':'Your submission is locked. Contact the staff if a correction is needed.',
'Bataille du Canyon':'Canyon Battle','Tempête du Désert':'Desert Storm',
'Indique ta disponibilité. Un seul vote par joueur.':'Indicate your availability. One vote per player.',
'Indique ta disponibilité pour l’événement. Un seul vote par joueur.':'Indicate your availability for the event. One vote per player.',
'Chargement de la session…':'Loading session…',
'Qui es-tu ?':'Who are you?','Sélectionne ton pseudo dans la liste':'Select your player name from the list',
'Ta disponibilité ?':'Your availability?',
'Présent':'Available','Remplaçant':'Substitute','Absent':'Unavailable',
'Disponible comme titulaire':'Available as a main player','Disponible si besoin':'Available if needed',
'Indisponible':'Not available','Je serai là — rôle titulaire':'I will attend — main player',
'Je ne serai pas là':'I will not attend',
'← Changer de pseudo':'← Change player name','← Changer de nom':'← Change name',
'Ta réponse est verrouillée. Contacte le staff pour une correction.':'Your response is locked. Contact the staff to request a correction.',
'Exemple : 51.00M':'Example: 51.00M','Recherche ton nom…':'Search your name…',
'Exemple de capture d’écran Last War attendue : écran de formation avec la puissance totale 23.22M visible en haut':'Example Last War screenshot: formation screen with total power 23.22M at the top',
'Aperçu de la capture':'Screenshot preview',
'Aucun sondage ouvert.':'No survey is currently open.',
'Ce sondage est clôturé.':'This survey is closed.',
'La session est clôturée.':'This session is closed.',
'Choisis une capture d’écran.':'Choose a screenshot.',
'Chargement de la reconnaissance… La première utilisation peut prendre 20 à 40 secondes.':'Loading text recognition… The first use may take 20–40 seconds.',
'Préparation de la capture…':'Preparing screenshot…',
'Puissance détectée : ':'Detected power: ',
'. Vérifie avant de valider.':'. Check before submitting.',
'Tu peux saisir la puissance dans la case, en conservant la capture.':'You can enter your power in the field while keeping the screenshot.',
'Image JPG, PNG ou WEBP de 5 Mo maximum.':'JPG, PNG or WEBP image, maximum 5 MB.',
};

const pollTranslationsEs={
"Recensement Puissance T1":"Censo de potencia T1",
"Pour déclarer ta puissance T1, ajoute une capture d’écran de ton équipe. La puissance sera reconnue automatiquement. Une seule déclaration par joueur et par recensement.":"Para declarar tu potencia T1, sube una captura de pantalla de tu equipo. La potencia se detectará automáticamente. Una declaración por jugador y por censo.",
"Chargement du recensement…":"Cargando censo…",
"Aucun recensement ouvert. Reviens à la prochaine session.":"No hay ningún censo abierto. Vuelve en la próxima sesión.",
"Ton pseudo":"Tu nombre de jugador",
"Chargement…":"Cargando…",
"Exemple de capture attendue":"Ejemplo de captura esperada",
"Prends une capture de l’écran de formation de ton équipe T1, avec ":"Haz una captura de la pantalla de formación de tu equipo T1, con ",
"la puissance totale bien visible en haut":"la potencia total claramente visible arriba",
" (ici : ":" (aquí: ",
"). Voici un exemple :":"). Aquí tienes un ejemplo:",
"L’image sert uniquement d’exemple : ajoute ta propre capture pour déclarer ta puissance.":"Esta imagen es solo un ejemplo: sube tu propia captura para declarar tu potencia.",
"Ajouter une capture d’écran":"Añadir una captura de pantalla",
"📷 Choisir une capture de ton équipe T1 (JPG / PNG / WEBP, max 5 Mo)":"📷 Elige una captura de tu equipo T1 (JPG / PNG / WEBP, máx. 5 MB)",
"Le site remplit automatiquement la puissance détectée. Vérifie-la et corrige-la si nécessaire avant de valider. La capture reste obligatoire.":"El sitio rellena automáticamente la potencia detectada. Compruébala y corrígela si es necesario antes de enviar. La captura es obligatoria.",
"⚡ Puissance T1 détectée (modifiable)":"⚡ Potencia T1 detectada (editable)",
"Valeur remplie après lecture de la capture. Tu peux la corriger manuellement (ex. 18.31, 18,31 ou 18.31M).":"Valor obtenido de la captura. Puedes corregirlo manualmente (ej. 51.00M).",
"✓ Valider ma puissance T1":"✓ Enviar mi potencia T1",
"Puissance enregistrée !":"¡Potencia guardada!",
"Ta déclaration est verrouillée. Contacte le staff pour toute correction.":"Tu declaración está bloqueada. Contacta con los responsables para corregirla.",
"Bataille du Canyon":"Batalla del Cañón",
"Tempête du Désert":"Tormenta del Desierto",
"Indique ta disponibilité. Un seul vote par joueur.":"Indica tu disponibilidad. Un voto por jugador.",
"Indique ta disponibilité pour l’événement. Un seul vote par joueur.":"Indica tu disponibilidad para el evento. Un voto por jugador.",
"Chargement de la session…":"Cargando sesión…",
"Qui es-tu ?":"¿Quién eres?",
"Sélectionne ton pseudo dans la liste":"Selecciona tu nombre en la lista",
"Ta disponibilité ?":"¿Cuál es tu disponibilidad?",
"Présent":"Disponible",
"Remplaçant":"Suplente",
"Absent":"Ausente",
"Disponible comme titulaire":"Disponible como titular",
"Disponible si besoin":"Disponible si hace falta",
"Indisponible":"No disponible",
"Je serai là — rôle titulaire":"Asistiré — titular",
"Je ne serai pas là":"No asistiré",
"← Changer de pseudo":"← Cambiar nombre de jugador",
"← Changer de nom":"← Cambiar nombre",
"Ta réponse est verrouillée. Contacte le staff pour une correction.":"Tu respuesta está bloqueada. Contacta con los responsables para corregirla.",
"Exemple : 51.00M":"Ejemplo: 51.00M",
"Recherche ton nom…":"Busca tu nombre…",
"Exemple de capture d’écran Last War attendue : écran de formation avec la puissance totale 23.22M visible en haut":"Ejemplo de captura de Last War: pantalla de formación con la potencia total 23.22M visible arriba",
"Aperçu de la capture":"Vista previa de la captura",
"Aucun sondage ouvert.":"No hay ninguna encuesta abierta.",
"Ce sondage est clôturé.":"Esta encuesta está cerrada.",
"La session est clôturée.":"La sesión está cerrada.",
"Choisis une capture d’écran.":"Elige una captura de pantalla.",
"Chargement de la reconnaissance… La première utilisation peut prendre 20 à 40 secondes.":"Cargando reconocimiento de texto… El primer uso puede tardar entre 20 y 40 segundos.",
"Préparation de la capture…":"Preparando captura…",
"Puissance détectée : ":"Potencia detectada: ",
". Vérifie avant de valider.":". Compruébala antes de enviar.",
"Tu peux saisir la puissance dans la case, en conservant la capture.":"Puedes introducir la potencia en el campo y conservar la captura.",
"Image JPG, PNG ou WEBP de 5 Mo maximum.":"Imagen JPG, PNG o WEBP de 5 MB como máximo."
};

const pollTranslationsDe={
 "Recensement Puissance T1": "T1-Kraft-Erfassung",
 "Pour déclarer ta puissance T1, ajoute une capture d’écran de ton équipe. La puissance sera reconnue automatiquement. Une seule déclaration par joueur et par recensement.": "Um deine T1-Kraft zu melden, lade einen Screenshot deines Teams hoch. Die Kraft wird automatisch erkannt. Eine Meldung pro Spieler und Erfassung.",
 "Chargement du recensement…": "Erfassung wird geladen…",
 "Aucun recensement ouvert. Reviens à la prochaine session.": "Derzeit ist keine Erfassung geöffnet. Komm zur nächsten Runde zurück.",
 "Ton pseudo": "Dein Spielername",
 "Chargement…": "Wird geladen…",
 "Exemple de capture attendue": "Beispiel für den Screenshot",
 "Prends une capture de l’écran de formation de ton équipe T1, avec ": "Erstelle einen Screenshot der T1-Teamaufstellung, auf dem ",
 "la puissance totale bien visible en haut": "die Gesamtkraft oben gut sichtbar ist",
 " (ici : ": " (hier: ",
 "). Voici un exemple :": "). Hier ein Beispiel:",
 "L’image sert uniquement d’exemple : ajoute ta propre capture pour déclarer ta puissance.": "Dieses Bild ist nur ein Beispiel. Lade deinen eigenen Screenshot hoch, um deine Kraft zu melden.",
 "Ajouter une capture d’écran": "Screenshot hinzufügen",
 "📷 Choisir une capture de ton équipe T1 (JPG / PNG / WEBP, max 5 Mo)": "📷 Screenshot deines T1-Teams auswählen (JPG / PNG / WEBP, max. 5 MB)",
 "Le site remplit automatiquement la puissance détectée. Vérifie-la et corrige-la si nécessaire avant de valider. La capture reste obligatoire.": "Die erkannte Kraft wird automatisch eingetragen. Prüfe und korrigiere sie bei Bedarf vor dem Absenden. Ein Screenshot ist weiterhin erforderlich.",
 "⚡ Puissance T1 détectée (modifiable)": "⚡ Erkannte T1-Kraft (bearbeitbar)",
 "Valeur remplie après lecture de la capture. Tu peux la corriger manuellement (ex. 18.31, 18,31 ou 18.31M).": "Wert aus dem Screenshot. Du kannst ihn manuell korrigieren (z. B. 51.00M).",
 "✓ Valider ma puissance T1": "✓ Meine T1-Kraft absenden",
 "Puissance enregistrée !": "Kraft gespeichert!",
 "Ta déclaration est verrouillée. Contacte le staff pour toute correction.": "Deine Meldung ist gesperrt. Wende dich für Korrekturen an die Leitung.",
 "Bataille du Canyon": "Canyon-Schlacht",
 "Tempête du Désert": "Wüstensturm",
 "Indique ta disponibilité. Un seul vote par joueur.": "Gib deine Verfügbarkeit an. Eine Stimme pro Spieler.",
 "Indique ta disponibilité pour l’événement. Un seul vote par joueur.": "Gib deine Verfügbarkeit für das Ereignis an. Eine Stimme pro Spieler.",
 "Chargement de la session…": "Runde wird geladen…",
 "Qui es-tu ?": "Wer bist du?",
 "Sélectionne ton pseudo dans la liste": "Wähle deinen Spielernamen aus der Liste",
 "Ta disponibilité ?": "Deine Verfügbarkeit?",
 "Présent": "Dabei",
 "Remplaçant": "Ersatzspieler",
 "Absent": "Abwesend",
 "Disponible comme titulaire": "Als Stammspieler verfügbar",
 "Disponible si besoin": "Bei Bedarf verfügbar",
 "Indisponible": "Nicht verfügbar",
 "Je serai là — rôle titulaire": "Ich bin dabei — Stammspieler",
 "Je ne serai pas là": "Ich bin nicht dabei",
 "← Changer de pseudo": "← Spielernamen ändern",
 "← Changer de nom": "← Namen ändern",
 "Ta réponse est verrouillée. Contacte le staff pour une correction.": "Deine Antwort ist gesperrt. Wende dich für Korrekturen an die Leitung.",
 "Exemple : 51.00M": "Beispiel: 51.00M",
 "Recherche ton nom…": "Suche deinen Namen…",
 "Exemple de capture d’écran Last War attendue : écran de formation avec la puissance totale 23.22M visible en haut": "Beispiel eines Last-War-Screenshots: Aufstellung mit der Gesamtkraft 23.22M oben",
 "Aperçu de la capture": "Screenshot-Vorschau",
 "Aucun sondage ouvert.": "Derzeit ist keine Umfrage geöffnet.",
 "Ce sondage est clôturé.": "Diese Umfrage ist geschlossen.",
 "La session est clôturée.": "Die Runde ist geschlossen.",
 "Choisis une capture d’écran.": "Wähle einen Screenshot aus.",
 "Chargement de la reconnaissance… La première utilisation peut prendre 20 à 40 secondes.": "Texterkennung wird geladen… Die erste Nutzung kann 20 bis 40 Sekunden dauern.",
 "Préparation de la capture…": "Screenshot wird vorbereitet…",
 "Puissance détectée : ": "Erkannte Kraft: ",
 ". Vérifie avant de valider.": ". Vor dem Absenden prüfen.",
 "Tu peux saisir la puissance dans la case, en conservant la capture.": "Du kannst die Kraft im Feld eingeben und den Screenshot beibehalten.",
 "Image JPG, PNG ou WEBP de 5 Mo maximum.": "JPG-, PNG- oder WEBP-Bild, maximal 5 MB."
};

const pollTranslationsIt={
 "Recensement Puissance T1": "Censimento potenza T1",
 "Pour déclarer ta puissance T1, ajoute une capture d’écran de ton équipe. La puissance sera reconnue automatiquement. Une seule déclaration par joueur et par recensement.": "Per dichiarare la tua potenza T1, carica uno screenshot della tua squadra. La potenza verrà rilevata automaticamente. Una dichiarazione per giocatore e per censimento.",
 "Chargement du recensement…": "Caricamento censimento…",
 "Aucun recensement ouvert. Reviens à la prochaine session.": "Nessun censimento aperto. Torna alla prossima sessione.",
 "Ton pseudo": "Il tuo nome giocatore",
 "Chargement…": "Caricamento…",
 "Exemple de capture attendue": "Esempio di screenshot richiesto",
 "Prends une capture de l’écran de formation de ton équipe T1, avec ": "Fai uno screenshot della formazione della tua squadra T1, con ",
 "la puissance totale bien visible en haut": "la potenza totale ben visibile in alto",
 " (ici : ": " (qui: ",
 "). Voici un exemple :": "). Ecco un esempio:",
 "L’image sert uniquement d’exemple : ajoute ta propre capture pour déclarer ta puissance.": "Questa immagine è solo un esempio: carica il tuo screenshot per dichiarare la potenza.",
 "Ajouter une capture d’écran": "Aggiungi uno screenshot",
 "📷 Choisir une capture de ton équipe T1 (JPG / PNG / WEBP, max 5 Mo)": "📷 Scegli uno screenshot della tua squadra T1 (JPG / PNG / WEBP, max 5 MB)",
 "Le site remplit automatiquement la puissance détectée. Vérifie-la et corrige-la si nécessaire avant de valider. La capture reste obligatoire.": "Il sito inserisce automaticamente la potenza rilevata. Controllala e correggila se necessario prima di inviare. Lo screenshot è obbligatorio.",
 "⚡ Puissance T1 détectée (modifiable)": "⚡ Potenza T1 rilevata (modificabile)",
 "Valeur remplie après lecture de la capture. Tu peux la corriger manuellement (ex. 18.31, 18,31 ou 18.31M).": "Valore ricavato dallo screenshot. Puoi correggerlo manualmente (es. 51.00M).",
 "✓ Valider ma puissance T1": "✓ Invia la mia potenza T1",
 "Puissance enregistrée !": "Potenza salvata!",
 "Ta déclaration est verrouillée. Contacte le staff pour toute correction.": "La tua dichiarazione è bloccata. Contatta lo staff per eventuali correzioni.",
 "Bataille du Canyon": "Battaglia del Canyon",
 "Tempête du Désert": "Tempesta del Deserto",
 "Indique ta disponibilité. Un seul vote par joueur.": "Indica la tua disponibilità. Un voto per giocatore.",
 "Indique ta disponibilité pour l’événement. Un seul vote par joueur.": "Indica la tua disponibilità per l'evento. Un voto per giocatore.",
 "Chargement de la session…": "Caricamento sessione…",
 "Qui es-tu ?": "Chi sei?",
 "Sélectionne ton pseudo dans la liste": "Seleziona il tuo nome dalla lista",
 "Ta disponibilité ?": "La tua disponibilità?",
 "Présent": "Presente",
 "Remplaçant": "Riserva",
 "Absent": "Assente",
 "Disponible comme titulaire": "Disponibile come titolare",
 "Disponible si besoin": "Disponibile se necessario",
 "Indisponible": "Non disponibile",
 "Je serai là — rôle titulaire": "Ci sarò — titolare",
 "Je ne serai pas là": "Non ci sarò",
 "← Changer de pseudo": "← Cambia nome giocatore",
 "← Changer de nom": "← Cambia nome",
 "Ta réponse est verrouillée. Contacte le staff pour une correction.": "La tua risposta è bloccata. Contatta lo staff per una correzione.",
 "Exemple : 51.00M": "Esempio: 51.00M",
 "Recherche ton nom…": "Cerca il tuo nome…",
 "Exemple de capture d’écran Last War attendue : écran de formation avec la puissance totale 23.22M visible en haut": "Esempio di screenshot Last War: schermata della formazione con potenza totale 23.22M visibile in alto",
 "Aperçu de la capture": "Anteprima dello screenshot",
 "Aucun sondage ouvert.": "Nessun sondaggio aperto.",
 "Ce sondage est clôturé.": "Questo sondaggio è chiuso.",
 "La session est clôturée.": "La sessione è chiusa.",
 "Choisis une capture d’écran.": "Scegli uno screenshot.",
 "Chargement de la reconnaissance… La première utilisation peut prendre 20 à 40 secondes.": "Caricamento riconoscimento testo… Il primo utilizzo può richiedere 20–40 secondi.",
 "Préparation de la capture…": "Preparazione screenshot…",
 "Puissance détectée : ": "Potenza rilevata: ",
 ". Vérifie avant de valider.": ". Controlla prima di inviare.",
 "Tu peux saisir la puissance dans la case, en conservant la capture.": "Puoi inserire la potenza nel campo mantenendo lo screenshot.",
 "Image JPG, PNG ou WEBP de 5 Mo maximum.": "Immagine JPG, PNG o WEBP di massimo 5 MB."
};

const RW_KEY='na1n_rewards_v17_local';

const mvStatuses={discussion:'En discussion',priority:'⭐ Prioritaire',confirmed:'Confirmé',finalized:'✅ Finalisé',completed:'Finalisé (ancien)',cancelled:'Annulé (ancien)'};

const mvColors=[['','⚪'],['gris','⚪'],['bleu','🔵'],['violet','🟣'],['or','🟡']];
