const pollStatsMessages = {
  fr: {
    title: 'Statistiques des sondages',
    survey: 'Sondage',
    participation: 'Participation',
    status: 'État',
    tdd: 'Tempête du désert',
    canyon: 'Canyon',
    t1: 'Recensement T1',
    loading: 'Chargement…',
    open: 'Ouvert',
    closed: 'Fermé',
    error: 'Erreur de chargement'
  },
  en: {
    title: 'Survey statistics',
    survey: 'Survey',
    participation: 'Participation',
    status: 'Status',
    tdd: 'Desert Storm',
    canyon: 'Canyon',
    t1: 'T1 Census',
    loading: 'Loading…',
    open: 'Open',
    closed: 'Closed',
    error: 'Loading error'
  },
  es: {
    title: 'Estadísticas de las encuestas',
    survey: 'Encuesta',
    participation: 'Participación',
    status: 'Estado',
    tdd: 'Tormenta del Desierto',
    canyon: 'Cañón',
    t1: 'Censo T1',
    loading: 'Cargando…',
    open: 'Abierta',
    closed: 'Cerrada',
    error: 'Error de carga'
  },
  de: {
    title: 'Umfragestatistiken',
    survey: 'Umfrage',
    participation: 'Teilnahme',
    status: 'Status',
    tdd: 'Wüstensturm',
    canyon: 'Canyon',
    t1: 'T1-Erfassung',
    loading: 'Wird geladen…',
    open: 'Offen',
    closed: 'Geschlossen',
    error: 'Ladefehler'
  },
  it: {
    title: 'Statistiche dei sondaggi',
    survey: 'Sondaggio',
    participation: 'Partecipazione',
    status: 'Stato',
    tdd: 'Tempesta del Deserto',
    canyon: 'Canyon',
    t1: 'Censimento T1',
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
pollStatsSection.className = 'poll-stats';
const pollStatsTitle = document.createElement('h2');
pollStatsTitle.className = 'poll-stats-title';
const pollStatsTable = document.createElement('table');
pollStatsTable.className = 'poll-stats-table';
const pollStatsHead = document.createElement('thead');
const pollStatsHeaderRow = document.createElement('tr');
const pollStatsBody = document.createElement('tbody');
const pollStatsCells = {};

['survey', 'answers', 'status'].forEach(key => {
  const cell = document.createElement('th');
  cell.scope = 'col';
  cell.className = 'poll-stats-heading';
  pollStatsHeaderRow.appendChild(cell);
});
pollStatsHead.appendChild(pollStatsHeaderRow);
pollStatsTable.append(pollStatsHead, pollStatsBody);

['tdd', 'canyon', 't1'].forEach(kind => {
  const row = document.createElement('tr');
  const nameCell = document.createElement('th');
  const countCell = document.createElement('td');
  const statusCell = document.createElement('td');
  const nameLabel = document.createElement('span');
  const countValue = document.createElement('span');
  const progress = document.createElement('div');
  const progressFill = document.createElement('span');
  const percentage = document.createElement('span');
  const statusBadge = document.createElement('span');
  nameCell.scope = 'row';
  nameCell.className = 'poll-stats-row-name';
  countCell.className = 'poll-stats-count';
  statusCell.className = 'poll-stats-status';
  nameLabel.className = 'poll-stats-name';
  countValue.className = 'poll-stats-count-value';
  progress.className = 'poll-stats-progress';
  progress.setAttribute('role', 'progressbar');
  progress.setAttribute('aria-valuemin', '0');
  progress.setAttribute('aria-valuemax', '100');
  progress.hidden = true;
  progressFill.className = 'poll-stats-progress-fill';
  percentage.className = 'poll-stats-percent';
  percentage.hidden = true;
  statusBadge.className = 'poll-stats-status-badge';
  progress.appendChild(progressFill);
  nameCell.appendChild(nameLabel);
  countCell.append(countValue, progress, percentage);
  statusCell.appendChild(statusBadge);
  pollStatsCells[kind] = {
    name: nameCell,
    nameLabel,
    count: countCell,
    countValue,
    progress,
    progressFill,
    percentage,
    status: statusCell,
    statusBadge
  };
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
  headers[1].textContent = messages.participation;
  headers[2].textContent = messages.status;

  ['tdd', 'canyon', 't1'].forEach(kind => {
    const cells = pollStatsCells[kind];
    const stats = pollStats[kind];
    cells.nameLabel.textContent = messages[kind];
    if (stats.error) {
      cells.countValue.textContent = '—';
      cells.progress.hidden = true;
      cells.percentage.hidden = true;
      cells.statusBadge.textContent = messages.error;
      cells.status.title = stats.error;
      cells.status.dataset.status = 'error';
    } else if (stats.answered === null) {
      cells.countValue.textContent = messages.loading;
      cells.progress.hidden = true;
      cells.percentage.hidden = true;
      cells.statusBadge.textContent = messages.loading;
      cells.status.removeAttribute('title');
      cells.status.dataset.status = 'loading';
    } else {
      const total = Math.max(0, Number(stats.total) || 0);
      const answered = Math.max(0, Number(stats.answered) || 0);
      const percent = total > 0 ? Math.min(100, Math.round(answered / total * 100)) : 0;
      cells.countValue.textContent = `${answered} / ${total}`;
      cells.progress.hidden = false;
      cells.progress.setAttribute('aria-label', `${messages.participation} — ${messages[kind]}`);
      cells.progress.setAttribute('aria-valuenow', String(percent));
      cells.progress.setAttribute('aria-valuetext', `${answered} / ${total} — ${percent} %`);
      cells.progressFill.style.width = `${percent}%`;
      cells.percentage.hidden = false;
      cells.percentage.textContent = `${percent} %`;
      cells.statusBadge.textContent = stats.open ? messages.open : messages.closed;
      cells.status.removeAttribute('title');
      cells.status.dataset.status = stats.open ? 'open' : 'closed';
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
