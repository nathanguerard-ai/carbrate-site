const storageKey = "budget-appartement-state-v2";
const legacyStorageKey = "budget-appartement-state";

const categoryPlan = [
  { name: "Logement", limit: 35, color: "#1f6b4f" },
  { name: "Services", limit: 8, color: "#047c89" },
  { name: "Épicerie", limit: 14, color: "#c58b16" },
  { name: "Transport", limit: 10, color: "#4768a8" },
  { name: "Assurances", limit: 6, color: "#7c5698" },
  { name: "Personnel", limit: 12, color: "#b3455d" },
  { name: "Épargne", limit: 15, color: "#2f806d" },
];

const defaultState = {
  settings: {
    income: 2600,
    savings: 250,
    emergency: 500,
    people: 2,
    rentTarget: 1050,
  },
  filters: {
    search: "",
    category: "Toutes",
    type: "Tous",
    status: "Tous",
  },
  expenses: [
    createExpense("Loyer", "Logement", 1200, "shared", 1, false, true, "À confirmer avec le bail."),
    createExpense("Hydro et chauffage", "Services", 120, "shared", 10, false, true, "Moyenne estimée."),
    createExpense("Internet", "Services", 70, "shared", 5, false, true, "Comparer les forfaits avant de signer."),
    createExpense("Épicerie", "Épicerie", 360, "variable", 0, false, true, "Budget personnel mensuel."),
    createExpense("Transport", "Transport", 120, "fixed", 1, false, true, "Passe mensuelle ou essence."),
    createExpense("Assurance locataire", "Assurances", 28, "fixed", 15, false, true, "Preuve parfois demandée par le propriétaire."),
  ],
  goals: [
    createGoal("Premier mois de loyer", 1200, 600, "2026-07-01"),
    createGoal("Meubles essentiels", 900, 250, "2026-08-15"),
    createGoal("Fonds d'urgence", 1500, 500, "2026-09-01"),
  ],
  checklist: [
    createTask("Lire le bail au complet", true),
    createTask("Demander le coût moyen d'hydro", false),
    createTask("Prévoir le dépôt ou le premier mois", false),
    createTask("Comparer internet et assurance locataire", false),
    createTask("Faire une liste d'achats essentiels", false),
  ],
  scenario: {
    rent: 1150,
    utilities: 150,
    groceries: 380,
    transport: 125,
    personal: 180,
  },
};

const moneyFormatter = new Intl.NumberFormat("fr-CA", {
  style: "currency",
  currency: "CAD",
  maximumFractionDigits: 0,
});

const percentFormatter = new Intl.NumberFormat("fr-CA", {
  maximumFractionDigits: 0,
});

const state = loadState();

const elements = {
  budgetForm: query("#budgetForm"),
  expenseForm: query("#expenseForm"),
  filterForm: query("#filterForm"),
  goalForm: query("#goalForm"),
  scenarioForm: query("#scenarioForm"),
  checklistForm: query("#checklistForm"),
  resetButton: query("#resetButton"),
  exportCsvButton: query("#exportCsvButton"),
  exportJsonButton: query("#exportJsonButton"),
  clearPaidButton: query("#clearPaidButton"),
  incomeInput: query("#incomeInput"),
  savingsInput: query("#savingsInput"),
  emergencyInput: query("#emergencyInput"),
  peopleInput: query("#peopleInput"),
  rentTargetInput: query("#rentTargetInput"),
  expenseName: query("#expenseName"),
  expenseCategory: query("#expenseCategory"),
  expenseAmount: query("#expenseAmount"),
  expenseType: query("#expenseType"),
  expenseDueDay: query("#expenseDueDay"),
  expenseStatus: query("#expenseStatus"),
  expenseEssential: query("#expenseEssential"),
  expenseNotes: query("#expenseNotes"),
  searchFilter: query("#searchFilter"),
  categoryFilter: query("#categoryFilter"),
  typeFilter: query("#typeFilter"),
  statusFilter: query("#statusFilter"),
  incomeTotal: query("#incomeTotal"),
  expenseTotal: query("#expenseTotal"),
  remainingTotal: query("#remainingTotal"),
  usageRate: query("#usageRate"),
  savingsRate: query("#savingsRate"),
  unpaidTotal: query("#unpaidTotal"),
  nextDue: query("#nextDue"),
  readinessScore: query("#readinessScore"),
  sharedTotal: query("#sharedTotal"),
  perPersonTotal: query("#perPersonTotal"),
  personalTotal: query("#personalTotal"),
  expenseTable: query("#expenseTable"),
  categoryGrid: query("#categoryGrid"),
  insightList: query("#insightList"),
  timelineList: query("#timelineList"),
  goalList: query("#goalList"),
  checklistList: query("#checklistList"),
  scenarioRent: query("#scenarioRent"),
  scenarioUtilities: query("#scenarioUtilities"),
  scenarioGroceries: query("#scenarioGroceries"),
  scenarioTransport: query("#scenarioTransport"),
  scenarioPersonal: query("#scenarioPersonal"),
  scenarioResult: query("#scenarioResult"),
  exportPreview: query("#exportPreview"),
};

hydrateInputs();
render();
bindEvents();

function bindEvents() {
  elements.budgetForm.addEventListener("submit", (event) => {
    event.preventDefault();
    state.settings.income = readMoney(elements.incomeInput.value);
    state.settings.savings = readMoney(elements.savingsInput.value);
    state.settings.emergency = readMoney(elements.emergencyInput.value);
    state.settings.people = clamp(Number(elements.peopleInput.value) || 1, 1, 8);
    state.settings.rentTarget = readMoney(elements.rentTargetInput.value);
    persistAndRender();
  });

  elements.expenseForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = elements.expenseName.value.trim();
    const amount = readMoney(elements.expenseAmount.value);

    if (!name || amount <= 0) {
      elements.expenseName.focus();
      return;
    }

    state.expenses.push(
      createExpense(
        name,
        elements.expenseCategory.value,
        amount,
        elements.expenseType.value,
        Number(elements.expenseDueDay.value) || 0,
        elements.expenseStatus.value === "paid",
        elements.expenseEssential.checked,
        elements.expenseNotes.value.trim(),
      ),
    );

    elements.expenseForm.reset();
    elements.expenseCategory.value = "Logement";
    elements.expenseType.value = "fixed";
    elements.expenseStatus.value = "unpaid";
    elements.expenseEssential.checked = true;
    elements.expenseName.focus();
    persistAndRender();
  });

  elements.filterForm.addEventListener("input", () => {
    state.filters.search = elements.searchFilter.value;
    state.filters.category = elements.categoryFilter.value;
    state.filters.type = elements.typeFilter.value;
    state.filters.status = elements.statusFilter.value;
    persistAndRender();
  });

  elements.expenseTable.addEventListener("click", (event) => {
    const deleteButton = event.target.closest("[data-delete-id]");
    const paidButton = event.target.closest("[data-toggle-paid-id]");

    if (deleteButton) {
      state.expenses = state.expenses.filter((expense) => expense.id !== deleteButton.dataset.deleteId);
      persistAndRender();
      return;
    }

    if (paidButton) {
      const expense = state.expenses.find((item) => item.id === paidButton.dataset.togglePaidId);
      if (expense) {
        expense.paid = !expense.paid;
        persistAndRender();
      }
    }
  });

  elements.goalForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = query("#goalName").value.trim();
    const target = readMoney(query("#goalTarget").value);
    const saved = readMoney(query("#goalSaved").value);
    const deadline = query("#goalDeadline").value;

    if (!name || target <= 0) {
      query("#goalName").focus();
      return;
    }

    state.goals.push(createGoal(name, target, saved, deadline));
    elements.goalForm.reset();
    persistAndRender();
  });

  elements.goalList.addEventListener("click", (event) => {
    const deleteButton = event.target.closest("[data-delete-goal-id]");
    if (!deleteButton) return;
    state.goals = state.goals.filter((goal) => goal.id !== deleteButton.dataset.deleteGoalId);
    persistAndRender();
  });

  elements.scenarioForm.addEventListener("input", () => {
    state.scenario.rent = readMoney(elements.scenarioRent.value);
    state.scenario.utilities = readMoney(elements.scenarioUtilities.value);
    state.scenario.groceries = readMoney(elements.scenarioGroceries.value);
    state.scenario.transport = readMoney(elements.scenarioTransport.value);
    state.scenario.personal = readMoney(elements.scenarioPersonal.value);
    persistAndRender();
  });

  elements.checklistForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = query("#taskName");
    const title = input.value.trim();
    if (!title) {
      input.focus();
      return;
    }
    state.checklist.push(createTask(title, false));
    input.value = "";
    persistAndRender();
  });

  elements.checklistList.addEventListener("click", (event) => {
    const toggleButton = event.target.closest("[data-toggle-task-id]");
    const deleteButton = event.target.closest("[data-delete-task-id]");

    if (toggleButton) {
      const task = state.checklist.find((item) => item.id === toggleButton.dataset.toggleTaskId);
      if (task) {
        task.done = !task.done;
        persistAndRender();
      }
      return;
    }

    if (deleteButton) {
      state.checklist = state.checklist.filter((task) => task.id !== deleteButton.dataset.deleteTaskId);
      persistAndRender();
    }
  });

  elements.clearPaidButton.addEventListener("click", () => {
    state.expenses.forEach((expense) => {
      expense.paid = false;
    });
    persistAndRender();
  });

  elements.exportCsvButton.addEventListener("click", () => {
    downloadFile("budget-appartement-depenses.csv", buildCsv(), "text/csv;charset=utf-8");
  });

  elements.exportJsonButton.addEventListener("click", () => {
    downloadFile("budget-appartement.json", JSON.stringify(state, null, 2), "application/json;charset=utf-8");
  });

  elements.resetButton.addEventListener("click", () => {
    const freshState = cloneDefaultState();
    Object.assign(state.settings, freshState.settings);
    Object.assign(state.filters, freshState.filters);
    state.expenses = freshState.expenses;
    state.goals = freshState.goals;
    state.checklist = freshState.checklist;
    state.scenario = freshState.scenario;
    hydrateInputs();
    persistAndRender();
  });
}

function render() {
  hydrateInputs();

  const totals = calculateTotals();
  elements.incomeTotal.textContent = formatMoney(state.settings.income);
  elements.expenseTotal.textContent = formatMoney(totals.totalPlanned);
  elements.remainingTotal.textContent = formatMoney(totals.remaining);
  elements.usageRate.textContent = `${formatPercent(totals.usageRate)}%`;
  elements.savingsRate.textContent = `${formatPercent(totals.savingsRate)}%`;
  elements.unpaidTotal.textContent = formatMoney(totals.unpaid);
  elements.nextDue.textContent = totals.nextDueLabel;
  elements.readinessScore.textContent = `${totals.readinessScore}/100`;
  elements.sharedTotal.textContent = formatMoney(totals.shared);
  elements.perPersonTotal.textContent = formatMoney(totals.perPerson);
  elements.personalTotal.textContent = formatMoney(totals.personal);
  elements.remainingTotal.style.color = totals.remaining < 0 ? "var(--rose)" : "var(--forest)";

  renderExpenses();
  renderCategories(totals);
  renderInsights(totals);
  renderTimeline();
  renderGoals();
  renderChecklist(totals);
  renderScenario();
  renderExportPreview(totals);
}

function renderExpenses() {
  const expenses = getFilteredExpenses();

  if (expenses.length === 0) {
    elements.expenseTable.innerHTML = `
      <tr>
        <td colspan="9">Aucune dépense ne correspond aux filtres.</td>
      </tr>
    `;
    return;
  }

  elements.expenseTable.innerHTML = expenses
    .map((expense) => {
      const perPerson = expense.type === "shared" ? expense.amount / state.settings.people : expense.amount;
      const notes = expense.notes ? `<small>${escapeHtml(expense.notes)}</small>` : "";
      return `
        <tr>
          <td>
            <strong>${escapeHtml(expense.name)}</strong>
            ${notes}
          </td>
          <td>${escapeHtml(expense.category)}</td>
          <td><span class="type-pill type-${expense.type}">${getTypeLabel(expense.type)}</span></td>
          <td>${expense.dueDay ? `Jour ${expense.dueDay}` : "Flexible"}</td>
          <td>${expense.essential ? "Essentielle" : "Optionnelle"}</td>
          <td>${formatMoney(expense.amount)}</td>
          <td>${formatMoney(perPerson)}</td>
          <td>
            <button class="status-button ${expense.paid ? "is-paid" : ""}" type="button" data-toggle-paid-id="${expense.id}">
              ${expense.paid ? "Payée" : "À payer"}
            </button>
          </td>
          <td>
            <button class="delete-button" type="button" data-delete-id="${expense.id}">
              Retirer
            </button>
          </td>
        </tr>
      `;
    })
    .join("");
}

function renderCategories(totals) {
  const categories = calculateCategories();
  categories["Épargne"] = (categories["Épargne"] || 0) + state.settings.savings;

  const cards = categoryPlan.map((plan) => {
    const amount = categories[plan.name] || 0;
    const percentage = totals.totalPlanned > 0 ? (amount / totals.totalPlanned) * 100 : 0;
    const incomePercentage = state.settings.income > 0 ? (amount / state.settings.income) * 100 : 0;
    const warningClass = incomePercentage > plan.limit ? " category-card-warning" : "";
    return `
      <article class="category-card${warningClass}">
        <span>${escapeHtml(plan.name)}</span>
        <strong>${formatMoney(amount)}</strong>
        <small>${formatPercent(percentage)}% du budget prévu · cible ${plan.limit}% du revenu</small>
        <div class="category-bar" aria-hidden="true">
          <div class="category-fill" style="width: ${Math.min(percentage, 100)}%; background: ${plan.color}"></div>
        </div>
      </article>
    `;
  });

  elements.categoryGrid.innerHTML = cards.join("");
}

function renderInsights(totals) {
  const insights = [];

  if (state.settings.income <= 0) {
    insights.push(["danger", "Ajoute ton revenu net pour obtenir un portrait réaliste du mois."]);
  } else if (totals.remaining < 0) {
    insights.push([
      "danger",
      `Il manque ${formatMoney(Math.abs(totals.remaining))}. Réduis une dépense variable ou revois le partage.`,
    ]);
  } else {
    insights.push(["success", `Il reste ${formatMoney(totals.remaining)} après les dépenses et l'épargne prévues.`]);
  }

  if (totals.housingRate > 35) {
    insights.push([
      "warning",
      `Le logement représente ${formatPercent(totals.housingRate)}% du revenu. Vise idéalement 35% ou moins.`,
    ]);
  } else {
    insights.push(["success", `Le logement reste à ${formatPercent(totals.housingRate)}% du revenu planifié.`]);
  }

  if (state.settings.savings < state.settings.income * 0.08) {
    insights.push(["warning", "L'épargne est basse. Vise au moins 8% du revenu si tes dépenses le permettent."]);
  } else {
    insights.push(["success", "Ton objectif d'épargne est intégré au budget mensuel."]);
  }

  if (totals.remaining < state.settings.emergency) {
    insights.push([
      "warning",
      `Le coussin restant est sous ton fonds d'urgence de ${formatMoney(state.settings.emergency)}.`,
    ]);
  } else {
    insights.push(["success", "Le fonds d'urgence minimum reste couvert après le budget prévu."]);
  }

  if (totals.unpaid > 0) {
    insights.push(["warning", `${formatMoney(totals.unpaid)} reste à payer ce mois-ci.`]);
  } else {
    insights.push(["success", "Toutes les dépenses listées sont marquées comme payées."]);
  }

  elements.insightList.innerHTML = insights
    .map(
      ([level, text]) => `
        <div class="insight-item status-${level}">
          <span class="status-dot"></span>
          <span>${escapeHtml(text)}</span>
        </div>
      `,
    )
    .join("");
}

function renderTimeline() {
  const timedExpenses = [...state.expenses]
    .filter((expense) => expense.dueDay > 0)
    .sort((a, b) => a.dueDay - b.dueDay);

  if (timedExpenses.length === 0) {
    elements.timelineList.innerHTML = `<p class="empty-state">Ajoute une journée d'échéance pour voir le calendrier.</p>`;
    return;
  }

  elements.timelineList.innerHTML = timedExpenses
    .map(
      (expense) => `
        <article class="timeline-item ${expense.paid ? "timeline-paid" : ""}">
          <div>
            <span>Jour ${expense.dueDay}</span>
            <strong>${escapeHtml(expense.name)}</strong>
          </div>
          <p>${formatMoney(expense.amount)} · ${expense.paid ? "payée" : "à payer"}</p>
        </article>
      `,
    )
    .join("");
}

function renderGoals() {
  if (state.goals.length === 0) {
    elements.goalList.innerHTML = `<p class="empty-state">Ajoute un objectif pour suivre ta préparation.</p>`;
    return;
  }

  elements.goalList.innerHTML = state.goals
    .map((goal) => {
      const progress = goal.target > 0 ? Math.min((goal.saved / goal.target) * 100, 100) : 0;
      const missing = Math.max(goal.target - goal.saved, 0);
      return `
        <article class="goal-card">
          <div class="goal-card-top">
            <div>
              <span>${goal.deadline ? formatDate(goal.deadline) : "Sans date limite"}</span>
              <strong>${escapeHtml(goal.name)}</strong>
            </div>
            <button type="button" class="delete-button" data-delete-goal-id="${goal.id}">Retirer</button>
          </div>
          <div class="category-bar" aria-hidden="true">
            <div class="category-fill" style="width: ${progress}%"></div>
          </div>
          <small>${formatMoney(goal.saved)} accumulé · ${formatMoney(missing)} restant</small>
        </article>
      `;
    })
    .join("");
}

function renderChecklist(totals) {
  const doneCount = state.checklist.filter((task) => task.done).length;
  const totalCount = state.checklist.length || 1;
  const taskScore = Math.round((doneCount / totalCount) * 100);

  elements.checklistList.innerHTML = state.checklist
    .map(
      (task) => `
        <article class="task-row ${task.done ? "task-done" : ""}">
          <button type="button" data-toggle-task-id="${task.id}">
            ${task.done ? "Fait" : "À faire"}
          </button>
          <span>${escapeHtml(task.title)}</span>
          <button type="button" class="delete-button" data-delete-task-id="${task.id}">Retirer</button>
        </article>
      `,
    )
    .join("");

  if (!state.checklist.length) {
    elements.checklistList.innerHTML = `<p class="empty-state">Ajoute les étapes importantes avant le déménagement.</p>`;
  }

  query("#checklistProgress").textContent = `${doneCount}/${state.checklist.length} tâches · ${taskScore}%`;
  query("#riskLevel").textContent = getRiskLabel(totals);
}

function renderScenario() {
  const monthlyCost =
    state.scenario.rent +
    state.scenario.utilities +
    state.scenario.groceries +
    state.scenario.transport +
    state.scenario.personal +
    state.settings.savings;
  const remaining = state.settings.income - monthlyCost;
  const rentGap = state.scenario.rent - state.settings.rentTarget;

  elements.scenarioResult.innerHTML = `
    <article class="scenario-card">
      <span>Coût simulé</span>
      <strong>${formatMoney(monthlyCost)}</strong>
      <small>${formatMoney(remaining)} resterait après ce scénario.</small>
    </article>
    <article class="scenario-card">
      <span>Écart avec ton loyer cible</span>
      <strong class="${rentGap > 0 ? "negative" : "positive"}">${formatMoney(Math.abs(rentGap))}</strong>
      <small>${rentGap > 0 ? "au-dessus de ta cible" : "sous ta cible"}</small>
    </article>
  `;
}

function renderExportPreview(totals) {
  const lines = [
    "Résumé du budget",
    `Revenu: ${formatMoney(state.settings.income)}`,
    `Dépenses prévues: ${formatMoney(totals.totalPlanned)}`,
    `Reste estimé: ${formatMoney(totals.remaining)}`,
    `Dépenses partagées: ${formatMoney(totals.shared)}`,
    `Part par personne: ${formatMoney(totals.perPerson)}`,
    `À payer: ${formatMoney(totals.unpaid)}`,
  ];
  elements.exportPreview.textContent = lines.join("\n");
}

function calculateTotals() {
  const shared = state.expenses
    .filter((expense) => expense.type === "shared")
    .reduce((total, expense) => total + expense.amount, 0);
  const fixed = state.expenses
    .filter((expense) => expense.type === "fixed")
    .reduce((total, expense) => total + expense.amount, 0);
  const variable = state.expenses
    .filter((expense) => expense.type === "variable")
    .reduce((total, expense) => total + expense.amount, 0);
  const unpaid = state.expenses
    .filter((expense) => !expense.paid)
    .reduce((total, expense) => total + expense.amount, 0);
  const personal = fixed + variable + state.settings.savings;
  const perPerson = shared / state.settings.people;
  const totalPlanned = fixed + variable + shared + state.settings.savings;
  const remaining = state.settings.income - totalPlanned;
  const usageRate = state.settings.income > 0 ? (totalPlanned / state.settings.income) * 100 : 0;
  const savingsRate = state.settings.income > 0 ? (state.settings.savings / state.settings.income) * 100 : 0;
  const housing = state.expenses
    .filter((expense) => expense.category === "Logement")
    .reduce((total, expense) => total + expense.amount, 0);
  const housingRate = state.settings.income > 0 ? (housing / state.settings.income) * 100 : 0;
  const nextDueExpense = [...state.expenses]
    .filter((expense) => !expense.paid && expense.dueDay > 0)
    .sort((a, b) => a.dueDay - b.dueDay)[0];
  const readinessScore = calculateReadinessScore({
    remaining,
    usageRate,
    savingsRate,
    housingRate,
    unpaid,
  });

  return {
    shared,
    fixed,
    variable,
    unpaid,
    personal,
    perPerson,
    totalPlanned,
    remaining,
    usageRate,
    savingsRate,
    housingRate,
    readinessScore,
    nextDueLabel: nextDueExpense ? `Jour ${nextDueExpense.dueDay}` : "Aucune",
  };
}

function calculateReadinessScore(totals) {
  let score = 100;
  if (totals.remaining < 0) score -= 35;
  if (totals.usageRate > 90) score -= 20;
  if (totals.housingRate > 35) score -= 15;
  if (totals.savingsRate < 8) score -= 12;
  if (totals.unpaid > state.settings.income * 0.45) score -= 8;
  const taskPenalty = state.checklist.length
    ? 10 - Math.round((state.checklist.filter((task) => task.done).length / state.checklist.length) * 10)
    : 10;
  score -= taskPenalty;
  return clamp(score, 0, 100);
}

function calculateCategories() {
  return state.expenses.reduce((bucket, expense) => {
    bucket[expense.category] = (bucket[expense.category] || 0) + expense.amount;
    return bucket;
  }, {});
}

function getFilteredExpenses() {
  const search = state.filters.search.trim().toLowerCase();
  return state.expenses.filter((expense) => {
    const matchesSearch =
      !search ||
      expense.name.toLowerCase().includes(search) ||
      expense.category.toLowerCase().includes(search) ||
      expense.notes.toLowerCase().includes(search);
    const matchesCategory = state.filters.category === "Toutes" || expense.category === state.filters.category;
    const matchesType = state.filters.type === "Tous" || expense.type === state.filters.type;
    const matchesStatus =
      state.filters.status === "Tous" ||
      (state.filters.status === "paid" && expense.paid) ||
      (state.filters.status === "unpaid" && !expense.paid);
    return matchesSearch && matchesCategory && matchesType && matchesStatus;
  });
}

function hydrateInputs() {
  elements.incomeInput.value = state.settings.income;
  elements.savingsInput.value = state.settings.savings;
  elements.emergencyInput.value = state.settings.emergency;
  elements.peopleInput.value = state.settings.people;
  elements.rentTargetInput.value = state.settings.rentTarget;
  elements.searchFilter.value = state.filters.search;
  elements.categoryFilter.value = state.filters.category;
  elements.typeFilter.value = state.filters.type;
  elements.statusFilter.value = state.filters.status;
  elements.scenarioRent.value = state.scenario.rent;
  elements.scenarioUtilities.value = state.scenario.utilities;
  elements.scenarioGroceries.value = state.scenario.groceries;
  elements.scenarioTransport.value = state.scenario.transport;
  elements.scenarioPersonal.value = state.scenario.personal;
}

function persistAndRender() {
  localStorage.setItem(storageKey, JSON.stringify(state));
  render();
}

function loadState() {
  const saved = readStoredState(storageKey) || migrateLegacyState() || cloneDefaultState();
  return normalizeState(saved);
}

function readStoredState(key) {
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : null;
  } catch {
    localStorage.removeItem(key);
    return null;
  }
}

function migrateLegacyState() {
  const legacy = readStoredState(legacyStorageKey);
  if (!legacy) return null;

  return {
    ...cloneDefaultState(),
    settings: {
      income: legacy.income || 0,
      savings: legacy.savings || 0,
      emergency: legacy.emergency || 0,
      people: legacy.people || 1,
      rentTarget: 1000,
    },
    expenses: Array.isArray(legacy.expenses)
      ? legacy.expenses.map((expense) =>
          createExpense(
            expense.name || "Dépense",
            expense.category || "Personnel",
            expense.amount || 0,
            expense.type || "fixed",
            0,
            false,
            true,
            "",
          ),
        )
      : cloneDefaultState().expenses,
  };
}

function normalizeState(saved) {
  const fresh = cloneDefaultState();
  return {
    settings: { ...fresh.settings, ...(saved.settings || {}) },
    filters: { ...fresh.filters, ...(saved.filters || {}) },
    expenses: Array.isArray(saved.expenses) ? saved.expenses.map(normalizeExpense) : fresh.expenses,
    goals: Array.isArray(saved.goals) ? saved.goals.map(normalizeGoal) : fresh.goals,
    checklist: Array.isArray(saved.checklist) ? saved.checklist.map(normalizeTask) : fresh.checklist,
    scenario: { ...fresh.scenario, ...(saved.scenario || {}) },
  };
}

function cloneDefaultState() {
  return {
    ...defaultState,
    settings: { ...defaultState.settings },
    filters: { ...defaultState.filters },
    scenario: { ...defaultState.scenario },
    expenses: defaultState.expenses.map(normalizeExpense),
    goals: defaultState.goals.map(normalizeGoal),
    checklist: defaultState.checklist.map(normalizeTask),
  };
}

function normalizeExpense(expense) {
  return {
    id: expense.id || makeId(),
    name: expense.name || "Dépense",
    category: expense.category || "Personnel",
    amount: readMoney(expense.amount),
    type: ["fixed", "variable", "shared"].includes(expense.type) ? expense.type : "fixed",
    dueDay: clamp(Number(expense.dueDay) || 0, 0, 31),
    paid: Boolean(expense.paid),
    essential: expense.essential !== false,
    notes: expense.notes || "",
  };
}

function normalizeGoal(goal) {
  return {
    id: goal.id || makeId(),
    name: goal.name || "Objectif",
    target: readMoney(goal.target),
    saved: readMoney(goal.saved),
    deadline: goal.deadline || "",
  };
}

function normalizeTask(task) {
  return {
    id: task.id || makeId(),
    title: task.title || "Tâche",
    done: Boolean(task.done),
  };
}

function createExpense(name, category, amount, type, dueDay, paid, essential, notes) {
  return {
    id: makeId(),
    name,
    category,
    amount,
    type,
    dueDay,
    paid,
    essential,
    notes,
  };
}

function createGoal(name, target, saved, deadline) {
  return {
    id: makeId(),
    name,
    target,
    saved,
    deadline,
  };
}

function createTask(title, done) {
  return {
    id: makeId(),
    title,
    done,
  };
}

function buildCsv() {
  const header = ["Dépense", "Catégorie", "Type", "Échéance", "Essentielle", "Montant", "Payée", "Notes"];
  const rows = state.expenses.map((expense) => [
    expense.name,
    expense.category,
    getTypeLabel(expense.type),
    expense.dueDay ? `Jour ${expense.dueDay}` : "Flexible",
    expense.essential ? "Oui" : "Non",
    expense.amount,
    expense.paid ? "Oui" : "Non",
    expense.notes,
  ]);
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
}

function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}

function csvCell(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function getRiskLabel(totals) {
  if (totals.remaining < 0) return "Budget à corriger";
  if (totals.usageRate > 90 || totals.housingRate > 35) return "À surveiller";
  if (totals.readinessScore >= 80) return "Solide";
  return "Correct";
}

function getTypeLabel(type) {
  if (type === "shared") return "Partagée";
  if (type === "variable") return "Variable";
  return "Fixe";
}

function formatMoney(value) {
  return moneyFormatter.format(value);
}

function formatPercent(value) {
  return percentFormatter.format(value);
}

function formatDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("fr-CA", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(`${value}T12:00:00`));
}

function readMoney(value) {
  return Math.max(0, Number(value) || 0);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function makeId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function query(selector) {
  return document.querySelector(selector);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return entities[character];
  });
}
