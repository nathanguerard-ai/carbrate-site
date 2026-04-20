const storageKey = "budget-appartement-simple-v1";

const defaultState = {
  income: 2600,
  savings: 250,
  emergency: 500,
  people: 2,
  expenses: [
    createExpense("Loyer", "Logement", 1200, "shared", false),
    createExpense("Hydro", "Services", 120, "shared", false),
    createExpense("Internet", "Services", 70, "shared", false),
    createExpense("Épicerie", "Épicerie", 360, "personal", false),
    createExpense("Transport", "Transport", 120, "personal", false),
    createExpense("Assurance locataire", "Assurances", 28, "personal", false),
  ],
};

const moneyFormatter = new Intl.NumberFormat("fr-CA", {
  style: "currency",
  currency: "CAD",
  maximumFractionDigits: 0,
});

let state = loadState();

const elements = {
  budgetForm: query("#budgetForm"),
  expenseForm: query("#expenseForm"),
  exportButton: query("#exportButton"),
  resetButton: query("#resetButton"),
  incomeInput: query("#incomeInput"),
  savingsInput: query("#savingsInput"),
  emergencyInput: query("#emergencyInput"),
  peopleInput: query("#peopleInput"),
  expenseName: query("#expenseName"),
  expenseCategory: query("#expenseCategory"),
  expenseAmount: query("#expenseAmount"),
  expenseType: query("#expenseType"),
  incomeTotal: query("#incomeTotal"),
  expenseTotal: query("#expenseTotal"),
  remainingTotal: query("#remainingTotal"),
  unpaidTotal: query("#unpaidTotal"),
  sharedTotal: query("#sharedTotal"),
  perPersonTotal: query("#perPersonTotal"),
  personalTotal: query("#personalTotal"),
  expenseTable: query("#expenseTable"),
  insightList: query("#insightList"),
};

bindEvents();
render();

function bindEvents() {
  elements.budgetForm.addEventListener("submit", (event) => {
    event.preventDefault();
    state.income = readMoney(elements.incomeInput.value);
    state.savings = readMoney(elements.savingsInput.value);
    state.emergency = readMoney(elements.emergencyInput.value);
    state.people = clamp(Number(elements.peopleInput.value) || 1, 1, 8);
    saveAndRender();
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
        false,
      ),
    );

    elements.expenseForm.reset();
    elements.expenseCategory.value = "Logement";
    elements.expenseType.value = "shared";
    elements.expenseName.focus();
    saveAndRender();
  });

  elements.expenseTable.addEventListener("click", (event) => {
    const paidButton = event.target.closest("[data-paid-id]");
    const deleteButton = event.target.closest("[data-delete-id]");

    if (paidButton) {
      const expense = state.expenses.find((item) => item.id === paidButton.dataset.paidId);
      if (expense) {
        expense.paid = !expense.paid;
        saveAndRender();
      }
      return;
    }

    if (deleteButton) {
      state.expenses = state.expenses.filter((item) => item.id !== deleteButton.dataset.deleteId);
      saveAndRender();
    }
  });

  elements.exportButton.addEventListener("click", () => {
    downloadCsv();
  });

  elements.resetButton.addEventListener("click", () => {
    state = cloneDefaultState();
    saveAndRender();
  });
}

function render() {
  syncInputs();
  const totals = getTotals();

  elements.incomeTotal.textContent = formatMoney(state.income);
  elements.expenseTotal.textContent = formatMoney(totals.total);
  elements.remainingTotal.textContent = formatMoney(totals.remaining);
  elements.unpaidTotal.textContent = formatMoney(totals.unpaid);
  elements.sharedTotal.textContent = formatMoney(totals.shared);
  elements.perPersonTotal.textContent = formatMoney(totals.perPerson);
  elements.personalTotal.textContent = formatMoney(totals.personal);
  elements.remainingTotal.style.color = totals.remaining < 0 ? "var(--red)" : "var(--green)";

  renderInsights(totals);
  renderExpenses();
}

function renderInsights(totals) {
  const insights = [];

  if (state.income <= 0) {
    insights.push(["danger", "Ajoute ton revenu net pour commencer."]);
  } else if (totals.remaining < 0) {
    insights.push(["danger", `Il manque ${formatMoney(Math.abs(totals.remaining))} pour couvrir le mois.`]);
  } else {
    insights.push(["success", `Il reste ${formatMoney(totals.remaining)} après les dépenses et l'épargne.`]);
  }

  if (totals.housingRate > 35) {
    insights.push(["warning", `Le logement prend ${Math.round(totals.housingRate)}% du revenu. Essaie de rester près de 35%.`]);
  }

  if (state.savings < state.income * 0.08) {
    insights.push(["warning", "Ton épargne est basse. Vise environ 8% du revenu si possible."]);
  } else {
    insights.push(["success", "L'épargne est bien intégrée dans le budget."]);
  }

  if (totals.remaining < state.emergency) {
    insights.push(["warning", `Ton reste est sous ton fonds d'urgence minimum de ${formatMoney(state.emergency)}.`]);
  }

  elements.insightList.innerHTML = insights
    .map(
      ([level, text]) => `
        <div class="insight ${level}">
          <span class="dot"></span>
          <span>${escapeHtml(text)}</span>
        </div>
      `,
    )
    .join("");
}

function renderExpenses() {
  if (state.expenses.length === 0) {
    elements.expenseTable.innerHTML = `<tr><td colspan="7">Aucune dépense ajoutée.</td></tr>`;
    return;
  }

  elements.expenseTable.innerHTML = state.expenses
    .map((expense) => {
      const perPerson = expense.type === "shared" ? expense.amount / state.people : expense.amount;
      return `
        <tr>
          <td><strong>${escapeHtml(expense.name)}</strong></td>
          <td>${escapeHtml(expense.category)}</td>
          <td><span class="type-pill type-${expense.type}">${getTypeLabel(expense.type)}</span></td>
          <td>${formatMoney(expense.amount)}</td>
          <td>${formatMoney(perPerson)}</td>
          <td>
            <button class="status-button ${expense.paid ? "is-paid" : ""}" type="button" data-paid-id="${expense.id}">
              ${expense.paid ? "Payée" : "À payer"}
            </button>
          </td>
          <td>
            <button class="delete-button" type="button" data-delete-id="${expense.id}">Retirer</button>
          </td>
        </tr>
      `;
    })
    .join("");
}

function getTotals() {
  const shared = sumExpenses("shared");
  const personalExpenses = sumExpenses("personal");
  const personal = personalExpenses + state.savings;
  const total = shared + personal;
  const unpaid = state.expenses
    .filter((expense) => !expense.paid)
    .reduce((sum, expense) => sum + expense.amount, 0);
  const housing = state.expenses
    .filter((expense) => expense.category === "Logement")
    .reduce((sum, expense) => sum + expense.amount, 0);

  return {
    shared,
    personal,
    total,
    unpaid,
    remaining: state.income - total,
    perPerson: shared / state.people,
    housingRate: state.income > 0 ? (housing / state.income) * 100 : 0,
  };
}

function sumExpenses(type) {
  return state.expenses
    .filter((expense) => expense.type === type)
    .reduce((sum, expense) => sum + expense.amount, 0);
}

function syncInputs() {
  elements.incomeInput.value = state.income;
  elements.savingsInput.value = state.savings;
  elements.emergencyInput.value = state.emergency;
  elements.peopleInput.value = state.people;
}

function saveAndRender() {
  localStorage.setItem(storageKey, JSON.stringify(state));
  render();
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (saved && Array.isArray(saved.expenses)) {
      return normalizeState(saved);
    }
  } catch {
    localStorage.removeItem(storageKey);
  }

  return cloneDefaultState();
}

function normalizeState(saved) {
  return {
    ...cloneDefaultState(),
    ...saved,
    income: readMoney(saved.income),
    savings: readMoney(saved.savings),
    emergency: readMoney(saved.emergency),
    people: clamp(Number(saved.people) || 1, 1, 8),
    expenses: saved.expenses.map(normalizeExpense),
  };
}

function normalizeExpense(expense) {
  return createExpense(
    expense.name || "Dépense",
    expense.category || "Personnel",
    readMoney(expense.amount),
    expense.type === "personal" ? "personal" : "shared",
    Boolean(expense.paid),
    expense.id,
  );
}

function cloneDefaultState() {
  return {
    ...defaultState,
    expenses: defaultState.expenses.map(normalizeExpense),
  };
}

function createExpense(name, category, amount, type, paid, id = makeId()) {
  return {
    id,
    name,
    category,
    amount,
    type,
    paid,
  };
}

function downloadCsv() {
  const rows = [
    ["Dépense", "Catégorie", "Type", "Montant", "Payée"],
    ...state.expenses.map((expense) => [
      expense.name,
      expense.category,
      getTypeLabel(expense.type),
      expense.amount,
      expense.paid ? "Oui" : "Non",
    ]),
  ];
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "budget-appartement.csv";
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}

function csvCell(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function getTypeLabel(type) {
  return type === "shared" ? "Commune" : "Personnelle";
}

function readMoney(value) {
  return Math.max(0, Number(value) || 0);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function formatMoney(value) {
  return moneyFormatter.format(value);
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
