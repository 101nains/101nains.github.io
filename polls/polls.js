const pollStatsMessages = {
  fr: {
    title: 'Statistiques des sondages',
    survey: 'Sondage',
    answers: 'Réponses / total des joueurs',
    status: 'État',
    tdd: 'Tempête du désert',
    canyon: 'Canyon',
    t1: 'Puissance T1',
    loading: 'Chargement…',
    open: 'Ouvert',
    closed: 'Fermé',
    error: 'Erreur de chargement'
  },
  en: {
    title: 'Survey statistics',
    survey: 'Survey',
    answers: 'Responses / total players',
    status: 'Status',
    tdd: 'Desert Storm',
    canyon: 'Canyon',
    t1: 'T1 Power',
    loading: 'Loading…',
    open: 'Open',
    closed: 'Closed',
    error: 'Loading error'
  },
  es: {
    title: 'Estadísticas de las encuestas',
    survey: 'Encuesta',
    answers: 'Respuestas / total de jugadores',
    status: 'Estado',
    tdd: 'Tormenta del Desierto',
    canyon: 'Cañón',
    t1: 'Poder T1',
    loading: 'Cargando…',
    open: 'Abierta',
    closed: 'Cerrada',
    error: 'Error de carga'
  },
  de: {
    title: 'Umfragestatistiken',
    survey: 'Umfrage',
    answers: 'Antworten / Spieler insgesamt',
    status: 'Status',
    tdd: 'Wüstensturm',
    canyon: 'Canyon',
    t1: 'T1-Stärke',
    loading: 'Wird geladen…',
    open: 'Offen',
    closed: 'Geschlossen',
    error: 'Ladefehler'
  },
  it: {
    title: 'Statistiche dei sondaggi',
    survey: 'Sondaggio',
    answers: 'Risposte / giocatori totali',
    status: 'Stato',
    tdd: 'Tempesta del Deserto',
    canyon: 'Canyon',
    t1: 'Potenza T1',
    loading: 'Caricamento…',
    open: 'Aperto',
    closed: 'Chiuso',
    error: 'Errore di caricamento'
  }
};

const pollStats = {
  tdd: { answered: null, total: null, open: null, error: null },
  canyon: { answered: null, total: null, open: null, error: null },
  t1: { answered: null, total: null, open: null, error: null }
};

const pollStatsSection = document.createElement('section');
pollStatsSection.style.cssText = 'max-width:860px;margin:24px auto 0;color:#f8f6e9';
const pollStatsTitle = document.createElement('h2');
pollStatsTitle.style.cssText = 'margin:0 0 12px;color:#ffda80;font-size:clamp(20px,3vw,26px);text-align:center';
const pollStatsTable = document.createElement('table');
pollStatsTable.style.cssText = 'width:100%;border-collapse:collapse;border:1px solid #ffffff35;border-radius:12px;overflow:hidden;background:#142235';
const pollStatsHead = document.createElement('thead');
const pollStatsHeaderRow = document.createElement('tr');
const pollStatsBody = document.createElement('tbody');
const pollStatsCells = {};

['survey', 'answers', 'status'].forEach(key => {
  const cell = document.createElement('th');
  cell.scope = 'col';
  cell.style.cssText = 'padding:11px 12px;background:#203a57;color:#ffda80;text-align:left;font-size:13px';
  pollStatsHeaderRow.appendChild(cell);
});
pollStatsHead.appendChild(pollStatsHeaderRow);
pollStatsTable.append(pollStatsHead, pollStatsBody);

['tdd', 'canyon', 't1'].forEach(kind => {
  const row = document.createElement('tr');
  const nameCell = document.createElement('th');
  const countCell = document.createElement('td');
  const statusCell = document.createElement('td');
  nameCell.scope = 'row';
  [nameCell, countCell, statusCell].forEach(cell => {
    cell.style.cssText = 'padding:11px 12px;border-top:1px solid #ffffff24;text-align:left;font-size:14px';
  });
  countCell.style.fontWeight = '800';
  countCell.style.textAlign = 'center';
  pollStatsCells[kind] = { name: nameCell, count: countCell, status: statusCell };
  row.append(nameCell, countCell, statusCell);
  pollStatsBody.appendChild(row);
});

pollStatsSection.append(pollStatsTitle, pollStatsTable);
document.querySelector('.content')?.appendChild(pollStatsSection);

function renderPollStats() {
  const messages = pollStatsMessages[document.documentElement.lang] || pollStatsMessages.fr;
  pollStatsTitle.textContent = messages.title;

  const headers = pollStatsHeaderRow.querySelectorAll('th');
  headers[0].textContent = messages.survey;
  headers[1].textContent = messages.answers;
  headers[2].textContent = messages.status;

  ['tdd', 'canyon', 't1'].forEach(kind => {
    const cells = pollStatsCells[kind];
    const stats = pollStats[kind];
    cells.name.textContent = messages[kind];
    if (stats.error) {
      cells.count.textContent = '—';
      cells.status.textContent = messages.error;
      cells.status.title = stats.error;
    } else if (stats.answered === null) {
      cells.count.textContent = messages.loading;
      cells.status.textContent = messages.loading;
      cells.status.removeAttribute('title');
    } else {
      cells.count.textContent = `${stats.answered} / ${stats.total}`;
      cells.status.textContent = stats.open ? messages.open : messages.closed;
      cells.status.removeAttribute('title');
    }
  });
}

function setPollStatsError(kind, error) {
  console.error(`Erreur de chargement des statistiques (${kind}) :`, error);
  pollStats[kind] = { answered: null, total: null, open: null, error: error?.message || String(error) };
  renderPollStats();
}

function countCurrentParticipants(votes, participantIds) {
  const currentVoters = new Set((votes || [])
    .map(vote => String(vote.participant_id))
    .filter(id => participantIds.has(id)));
  return currentVoters.size;
}

async function loadAvailabilityStats(client, kind, participantIds) {
  try {
    const table = kind === 'tdd' ? 'tdd_poll' : 'canyon_poll';
    const [sessionResult, voteResult] = await Promise.all([
      client.from('availability_sessions')
        .select('id')
        .eq('kind', kind)
        .eq('status', 'open')
        .order('opened_at', { ascending: false })
        .limit(1),
      client.from(table).select('participant_id')
    ]);
    if (sessionResult.error) throw sessionResult.error;
    if (voteResult.error) throw voteResult.error;

    pollStats[kind] = {
      answered: countCurrentParticipants(voteResult.data, participantIds),
      total: participantIds.size,
      open: Boolean(sessionResult.data?.[0]),
      error: null
    };
    renderPollStats();
  } catch (error) {
    setPollStatsError(kind, error);
  }
}

async function loadT1Stats(client, participantIds) {
  try {
    const { data: rounds, error: roundError } = await client
      .from('t1_rounds')
      .select('id,status')
      .order('opened_at', { ascending: false })
      .limit(1);
    if (roundError) throw roundError;

    const round = rounds?.[0];
    if (!round) {
      pollStats.t1 = { answered: 0, total: participantIds.size, open: false, error: null };
      renderPollStats();
      return;
    }

    const { data: votes, error: voteError } = await client
      .from('t1_submissions')
      .select('participant_id')
      .eq('round_id', round.id);
    if (voteError) throw voteError;

    pollStats.t1 = {
      answered: countCurrentParticipants(votes, participantIds),
      total: participantIds.size,
      open: round.status === 'open',
      error: null
    };
    renderPollStats();
  } catch (error) {
    setPollStatsError('t1', error);
  }
}

function startPollStats() {
  if (typeof supabase === 'undefined' || typeof SUPABASE_URL === 'undefined' || typeof SUPABASE_KEY === 'undefined') {
    ['tdd', 'canyon', 't1'].forEach(kind => setPollStatsError(kind, 'Supabase indisponible.'));
    return;
  }

  let client;
  try {
    client = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  } catch (error) {
    ['tdd', 'canyon', 't1'].forEach(kind => setPollStatsError(kind, error));
    return;
  }

  let refreshTimer;
  let refreshInProgress = false;
  let refreshAgain = false;

  async function refresh() {
    if (refreshInProgress) {
      refreshAgain = true;
      return;
    }
    refreshInProgress = true;
    try {
      const { data: participants, error } = await client
        .from('participants')
        .select('id');
      if (error) throw error;
      const participantIds = new Set((participants || [])
        .map(participant => String(participant.id)));
      await Promise.all([
        loadAvailabilityStats(client, 'tdd', participantIds),
        loadAvailabilityStats(client, 'canyon', participantIds),
        loadT1Stats(client, participantIds)
      ]);
    } catch (error) {
      ['tdd', 'canyon', 't1'].forEach(kind => setPollStatsError(kind, error));
    } finally {
      refreshInProgress = false;
      if (refreshAgain) {
        refreshAgain = false;
        scheduleRefresh();
      }
    }
  }

  function scheduleRefresh() {
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(refresh, 250);
  }

  client.channel('polls_public_statistics')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'availability_sessions' }, scheduleRefresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tdd_poll' }, scheduleRefresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'canyon_poll' }, scheduleRefresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 't1_rounds' }, scheduleRefresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 't1_submissions' }, scheduleRefresh)
    .subscribe(status => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.error('Mise à jour des statistiques en temps réel indisponible :', status);
      }
    });

  window.setInterval(scheduleRefresh, 30000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') scheduleRefresh();
  });
  document.querySelectorAll('.lang').forEach(button => button.addEventListener('click', renderPollStats));
  renderPollStats();
  refresh();
}

startPollStats();
