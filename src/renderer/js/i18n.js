/**
 * LearningModules i18n — Internationalization (DE/EN)
 */

const TRANSLATIONS = {
  de: {
    // Login
    'app.title': 'LernModule',
    'app.subtitle': 'Interaktive Lernplattform mit H5P',
    'login.name.label': 'Dein Name',
    'login.name.placeholder': 'Name eingeben...',
    'login.student': '🎓 Als Schüler anmelden',
    'login.or': 'oder',
    'login.teacher.toggle': '🔐 Zum Lehrer-Bereich',
    'login.admin.username.label': 'Benutzername',
    'login.admin.username.placeholder': 'admin',
    'login.admin.password.label': 'Passwort',
    'login.admin.password.placeholder': 'Passwort...',
    'login.admin.submit': '🔑 Lehrer-Login',
    'login.admin.error': 'Falsche Anmeldedaten.',

    // Sidebar
    'nav.dashboard': 'Dashboard',
    'nav.topics': 'Lernthemen',
    'nav.modules': 'Module verwalten',
    'nav.results': 'Ergebnisse',
    'nav.student.topics': 'Lernthemen',
    'nav.student.quiz': 'Quiz starten',
    'nav.logout': '🚪 Abmelden',

    // Roles
    'role.teacher': 'Lehrer',
    'role.student': 'Schüler',

    // Dashboard
    'dashboard.title': 'Lehrer-Dashboard',
    'dashboard.subtitle': 'Übersicht über Ihre Lernthemen und Schüler-Ergebnisse',
    'dashboard.stat.topics': 'Lernthemen',
    'dashboard.stat.modules': 'Module gesamt',
    'dashboard.stat.active': 'Aktive Themen',
    'dashboard.stat.results': 'Quiz-Ergebnisse',
    'dashboard.types.title': 'Verfügbare H5P-Modultypen',

    // Topics
    'topics.title': 'Lernthemen verwalten',
    'topics.subtitle': 'Erstellen und verwalten Sie Lernthemen. Nur aktivierte Themen sind für Schüler sichtbar.',
    'topics.new': '➕ Neues Lernthema',
    'topics.import': '📥 Thema importieren',
    'topics.empty': 'Noch keine Lernthemen erstellt.',
    'topics.form.new': 'Neues Lernthema',
    'topics.form.edit': 'Lernthema bearbeiten',
    'topics.form.name': 'Themenname *',
    'topics.form.name.placeholder': 'z.B. Mathematik Grundlagen',
    'topics.form.desc': 'Beschreibung',
    'topics.form.desc.placeholder': 'Optionale Beschreibung...',
    'topics.form.save': 'Speichern',
    'topics.form.cancel': 'Abbrechen',
    'topics.modules.btn': '📦 Module',
    'topics.toggle.title': 'Für Schüler freigeben',
    'topics.active': '✅ Aktiv',
    'topics.inactive': '❌ Inaktiv',
    'topics.activated': 'Thema aktiviert',
    'topics.deactivated': 'Thema deaktiviert',
    'topics.exported': 'Thema exportiert!',
    'topics.deleted': 'Lernthema gelöscht.',
    'topics.updated': 'Thema aktualisiert!',
    'topics.created': 'Thema erstellt!',
    'topics.delete.confirm': 'Lernthema "{title}" wirklich löschen? Alle zugehörigen Module werden ebenfalls gelöscht.',
    'topics.import.success': 'Thema "{title}" mit {count} Modulen importiert!',
    'topics.import.error': 'Import fehlgeschlagen: ',

    // Modules
    'modules.title': 'Module verwalten',
    'modules.breadcrumb.topics': '📂 Lernthemen',
    'modules.search.placeholder': 'Module durchsuchen...',
    'modules.filter.all': 'Alle Typen',
    'modules.new': '➕ Neues Modul',
    'modules.export': '📤 Thema exportieren',
    'modules.empty': 'Noch keine Module in diesem Thema.',
    'modules.empty.search': 'Keine Module gefunden.',
    'modules.select.topic': 'Bitte wählen Sie zuerst ein Lernthema.',
    'modules.preview': '▶ Vorschau',
    'modules.edit': '✏️ Bearbeiten',
    'modules.delete.confirm': 'Modul "{title}" wirklich löschen?',
    'modules.deleted': 'Modul gelöscht.',
    'modules.in': 'Module in "{title}"',

    // Create/Edit Module
    'module.create.title': 'Neues Modul erstellen',
    'module.edit.title': 'Modul bearbeiten',
    'module.title.label': 'Titel *',
    'module.title.placeholder': 'Titel des Lernmoduls eingeben...',
    'module.type.label': 'H5P-Modultyp *',
    'module.type.placeholder': '— Modultyp wählen —',
    'module.desc.label': 'Beschreibung',
    'module.desc.placeholder': 'Optionale Beschreibung...',
    'module.save': 'Modul speichern',
    'module.cancel': 'Abbrechen',
    'module.saved': 'Modul erstellt!',
    'module.updated': 'Modul aktualisiert!',
    'module.save.error': 'Fehler beim Speichern.',
    'module.missing.topic': 'Kein Thema ausgewählt.',
    'module.missing.fields': 'Bitte Titel und Modultyp angeben.',

    // Player
    'player.title': 'Modul-Vorschau',
    'player.back': '← Zurück',

    // Results
    'results.title': 'Quiz-Ergebnisse',
    'results.subtitle': 'Übersicht aller Schüler-Ergebnisse',
    'results.search.placeholder': 'Nach Schüler filtern...',
    'results.delete.all': '🗑 Alle löschen',
    'results.delete.all.confirm': 'Wirklich ALLE Ergebnisse löschen?',
    'results.all.deleted': 'Alle Ergebnisse gelöscht.',
    'results.deleted': 'Ergebnis gelöscht.',
    'results.empty': 'Noch keine Ergebnisse vorhanden.',
    'results.stat.runs': 'Quiz-Durchläufe',
    'results.stat.students': 'Verschiedene Schüler',
    'results.stat.avg': 'Ø Erfolgsquote',
    'results.details.show': 'Details anzeigen',
    'results.answer': 'Antwort',
    'results.correct': 'Korrekt',

    // Student Topics
    'student.topics.title': 'Lernthemen auswählen',
    'student.topics.subtitle': 'Wähle die Themen aus, die du bearbeiten möchtest.',
    'student.topics.empty': 'Noch keine Lernthemen vom Lehrer freigegeben.',
    'student.topics.select': 'Thema auswählen',
    'student.topics.selected': 'Thema ausgewählt!',
    'student.topics.deselected': 'Thema abgewählt.',

    // Quiz
    'quiz.title': 'Quiz-Modus',
    'quiz.subtitle': 'Wähle ein Thema, um das Quiz zu starten.',
    'quiz.empty': 'Du hast noch keine Themen ausgewählt. Gehe zu "Lernthemen" und wähle Themen aus.',
    'quiz.start': '🧠 Quiz starten',
    'quiz.no.modules': 'Dieses Thema hat keine Module.',
    'quiz.next': 'Weiter →',
    'quiz.finish': '✅ Quiz beenden',
    'quiz.cancel': 'Quiz abbrechen',
    'quiz.cancel.confirm': 'Quiz wirklich abbrechen?',
    'quiz.module.of': 'Modul {current} von {total}:',
    'quiz.complete': 'Quiz abgeschlossen!',
    'quiz.topic': 'Thema',
    'quiz.prev': '← Zurück',
    'quiz.restart': '🔄 Neues Quiz',

    // Common
    'common.module.count': '{count} Module',
    'common.correct': '✓ Richtig!',
    'common.wrong': '✗ Nicht ganz richtig. Versuchen Sie es nochmal.',
    'common.check': 'Überprüfen',
    'common.true': 'Wahr',
    'common.false': 'Falsch',
    'common.of': 'von',
    'common.correct.words': 'korrekte Wörter markiert',
    'common.correct.answer': 'richtig',
    'common.viewed': 'Angesehen',
    'common.your.answer': 'Deine Antwort',
    'common.prev': '← Zurück',
    'common.next': 'Weiter →',
    'common.click.flip': 'Klicken zum Umdrehen',

    // Settings
    'settings.theme': 'Design',
    'settings.language': 'Sprache',

    // Confirm dialog
    'confirm.yes': 'Ja',
    'confirm.no': 'Abbrechen',
  },

  en: {
    // Login
    'app.title': 'LearnModules',
    'app.subtitle': 'Interactive Learning Platform with H5P',
    'login.name.label': 'Your Name',
    'login.name.placeholder': 'Enter name...',
    'login.student': '🎓 Sign in as Student',
    'login.or': 'or',
    'login.teacher.toggle': '🔐 Teacher Area',
    'login.admin.username.label': 'Username',
    'login.admin.username.placeholder': 'admin',
    'login.admin.password.label': 'Password',
    'login.admin.password.placeholder': 'Password...',
    'login.admin.submit': '🔑 Teacher Login',
    'login.admin.error': 'Invalid credentials.',

    // Sidebar
    'nav.dashboard': 'Dashboard',
    'nav.topics': 'Learning Topics',
    'nav.modules': 'Manage Modules',
    'nav.results': 'Results',
    'nav.student.topics': 'Learning Topics',
    'nav.student.quiz': 'Start Quiz',
    'nav.logout': '🚪 Sign Out',

    // Roles
    'role.teacher': 'Teacher',
    'role.student': 'Student',

    // Dashboard
    'dashboard.title': 'Teacher Dashboard',
    'dashboard.subtitle': 'Overview of your learning topics and student results',
    'dashboard.stat.topics': 'Learning Topics',
    'dashboard.stat.modules': 'Total Modules',
    'dashboard.stat.active': 'Active Topics',
    'dashboard.stat.results': 'Quiz Results',
    'dashboard.types.title': 'Available H5P Module Types',

    // Topics
    'topics.title': 'Manage Learning Topics',
    'topics.subtitle': 'Create and manage learning topics. Only activated topics are visible to students.',
    'topics.new': '➕ New Topic',
    'topics.import': '📥 Import Topic',
    'topics.empty': 'No learning topics created yet.',
    'topics.form.new': 'New Learning Topic',
    'topics.form.edit': 'Edit Learning Topic',
    'topics.form.name': 'Topic Name *',
    'topics.form.name.placeholder': 'e.g. Math Basics',
    'topics.form.desc': 'Description',
    'topics.form.desc.placeholder': 'Optional description...',
    'topics.form.save': 'Save',
    'topics.form.cancel': 'Cancel',
    'topics.modules.btn': '📦 Modules',
    'topics.toggle.title': 'Share with students',
    'topics.active': '✅ Active',
    'topics.inactive': '❌ Inactive',
    'topics.activated': 'Topic activated',
    'topics.deactivated': 'Topic deactivated',
    'topics.exported': 'Topic exported!',
    'topics.deleted': 'Learning topic deleted.',
    'topics.updated': 'Topic updated!',
    'topics.created': 'Topic created!',
    'topics.delete.confirm': 'Really delete topic "{title}"? All associated modules will also be deleted.',
    'topics.import.success': 'Topic "{title}" imported with {count} modules!',
    'topics.import.error': 'Import failed: ',

    // Modules
    'modules.title': 'Manage Modules',
    'modules.breadcrumb.topics': '📂 Learning Topics',
    'modules.search.placeholder': 'Search modules...',
    'modules.filter.all': 'All Types',
    'modules.new': '➕ New Module',
    'modules.export': '📤 Export Topic',
    'modules.empty': 'No modules in this topic yet.',
    'modules.empty.search': 'No modules found.',
    'modules.select.topic': 'Please select a learning topic first.',
    'modules.preview': '▶ Preview',
    'modules.edit': '✏️ Edit',
    'modules.delete.confirm': 'Really delete module "{title}"?',
    'modules.deleted': 'Module deleted.',
    'modules.in': 'Modules in "{title}"',

    // Create/Edit Module
    'module.create.title': 'Create New Module',
    'module.edit.title': 'Edit Module',
    'module.title.label': 'Title *',
    'module.title.placeholder': 'Enter module title...',
    'module.type.label': 'H5P Module Type *',
    'module.type.placeholder': '— Choose module type —',
    'module.desc.label': 'Description',
    'module.desc.placeholder': 'Optional description...',
    'module.save': 'Save Module',
    'module.cancel': 'Cancel',
    'module.saved': 'Module created!',
    'module.updated': 'Module updated!',
    'module.save.error': 'Error saving.',
    'module.missing.topic': 'No topic selected.',
    'module.missing.fields': 'Please provide title and module type.',

    // Player
    'player.title': 'Module Preview',
    'player.back': '← Back',

    // Results
    'results.title': 'Quiz Results',
    'results.subtitle': 'Overview of all student results',
    'results.search.placeholder': 'Filter by student...',
    'results.delete.all': '🗑 Delete All',
    'results.delete.all.confirm': 'Really delete ALL results?',
    'results.all.deleted': 'All results deleted.',
    'results.deleted': 'Result deleted.',
    'results.empty': 'No results available yet.',
    'results.stat.runs': 'Quiz Runs',
    'results.stat.students': 'Unique Students',
    'results.stat.avg': 'Ø Success Rate',
    'results.details.show': 'Show Details',
    'results.answer': 'Answer',
    'results.correct': 'Correct',

    // Student Topics
    'student.topics.title': 'Select Learning Topics',
    'student.topics.subtitle': 'Choose the topics you want to work on.',
    'student.topics.empty': 'No learning topics available from the teacher yet.',
    'student.topics.select': 'Select topic',
    'student.topics.selected': 'Topic selected!',
    'student.topics.deselected': 'Topic deselected.',

    // Quiz
    'quiz.title': 'Quiz Mode',
    'quiz.subtitle': 'Choose a topic to start the quiz.',
    'quiz.empty': 'You haven\'t selected any topics yet. Go to "Learning Topics" and select some.',
    'quiz.start': '🧠 Start Quiz',
    'quiz.no.modules': 'This topic has no modules.',
    'quiz.next': 'Next →',
    'quiz.finish': '✅ Finish Quiz',
    'quiz.cancel': 'Cancel Quiz',
    'quiz.cancel.confirm': 'Really cancel the quiz?',
    'quiz.module.of': 'Module {current} of {total}:',
    'quiz.complete': 'Quiz Complete!',
    'quiz.topic': 'Topic',
    'quiz.prev': '← Back',
    'quiz.restart': '🔄 New Quiz',

    // Common
    'common.module.count': '{count} Modules',
    'common.correct': '✓ Correct!',
    'common.wrong': '✗ Not quite right. Try again.',
    'common.check': 'Check',
    'common.true': 'True',
    'common.false': 'False',
    'common.of': 'of',
    'common.correct.words': 'correct words marked',
    'common.correct.answer': 'correct',
    'common.viewed': 'Viewed',
    'common.your.answer': 'Your answer',
    'common.prev': '← Back',
    'common.next': 'Next →',
    'common.click.flip': 'Click to flip',

    // Settings
    'settings.theme': 'Theme',
    'settings.language': 'Language',

    // Confirm dialog
    'confirm.yes': 'Yes',
    'confirm.no': 'Cancel',
  },
};

let currentLang = localStorage.getItem('app-language') || 'de';

/**
 * Get a translated string. Supports {placeholder} interpolation.
 * @param {string} key - Translation key
 * @param {Object} [params] - Key-value pairs for interpolation
 * @returns {string}
 */
function t(key, params) {
  const dict = TRANSLATIONS[currentLang] || TRANSLATIONS.de;
  let str = dict[key] || TRANSLATIONS.de[key] || key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
    }
  }
  return str;
}

/**
 * Apply translations to all elements with data-i18n attributes.
 */
function applyTranslations() {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    el.textContent = t(key);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    el.placeholder = t(el.getAttribute('data-i18n-placeholder'));
  });
  document.querySelectorAll('[data-i18n-title]').forEach((el) => {
    el.title = t(el.getAttribute('data-i18n-title'));
  });
  // Update html lang attribute
  document.documentElement.lang = currentLang;
}

/**
 * Set the active language and refresh the UI.
 * @param {string} lang - 'de' or 'en'
 */
function setLanguage(lang) {
  if (!TRANSLATIONS[lang]) return;
  currentLang = lang;
  localStorage.setItem('app-language', lang);
  applyTranslations();
}

/**
 * Get the current language code.
 * @returns {string}
 */
function getLanguage() {
  return currentLang;
}
