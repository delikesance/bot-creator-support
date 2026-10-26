/** Textes vus par l'utilisateur sur Discord, selon sa langue (`interaction.locale`). Le support, lui, se fait en anglais. */

export interface Pack {
  /** `{id}` : numéro du ticket. */
  welcome: string;
  /** Prévient que l'échange se fera en anglais ; vide pour l'anglais. */
  english: string;
  /** `{id}` : numéro du ticket, `{channel}` : salon. */
  opened: string;
  /** `{n}` : nombre de tickets déjà ouverts. */
  quota: string;
  noPerm: string;
  wrongChannel: string;
  closedReply: string;
  reopenedReply: string;
  error: string;
  emptySubject: string;
  /** Messages postés dans le salon à la fermeture / réouverture. */
  noticeClosed: string;
  noticeReopened: string;
  modalTitle: string;
  subjectLabel: string;
  subjectPh: string;
  descLabel: string;
  descPh: string;
  /** Panneau « Ouvrir un ticket » posté par /setup. */
  panel: string;
  panelBtn: string;
  panelPosted: string;
  /** Descriptions des commandes slash. */
  cmdTicket: string;
  cmdClose: string;
  cmdSetup: string;
  /** Message accompagnant la transcription envoyée à la fermeture. */
  transcriptText: string;
  /** Demande de note postée à la fermeture (boutons de 1 à 5), remerciement et refus d'une seconde note. */
  ratingPrompt: string;
  ratingThanks: string;
  ratingDone: string;
}

const PACKS: Record<string, Pack> = {
  en: {
    welcome: "Your ticket #{id} has been received: a team member will pick it up shortly.",
    english: "",
    opened: "✅ Your ticket #{id} is open: {channel}",
    quota: "You already have {n} open ticket(s). Close one before opening a new one.",
    noPerm: "⛔ You don't have permission to do that.",
    wrongChannel: "⚠️ This action is only available in a ticket channel.",
    closedReply: "🔴 Ticket closed.",
    reopenedReply: "🟢 Ticket reopened.",
    error: "❌ Something went wrong, please try again in a moment.",
    emptySubject: "The title can't be empty.",
    noticeClosed: "🔴 Your ticket is closed. Thank you for contacting us!",
    noticeReopened: "🟢 Your ticket has been reopened.",
    modalTitle: "Open a ticket",
    subjectLabel: "Title",
    subjectPh: "E.g. I can't log in",
    descLabel: "Detailed description",
    descPh: "What happened? What were you trying to do? Error messages, steps to reproduce…",
    panel: "## 🎫 Support\nAn issue or a question? Click the button to open a private ticket with the team.",
    panelBtn: "Open a ticket",
    panelPosted: "✅ Panel posted.",
    cmdTicket: "Open a support ticket",
    cmdClose: "Close this channel's ticket",
    cmdSetup: "Post the “Open a ticket” panel in this channel",
    ratingPrompt: "How was the support you received? Pick a rating from 1 (poor) to 5 (excellent).",
    ratingThanks: "Thank you for your feedback!",
    ratingDone: "You have already rated this ticket.",
    transcriptText: "Here is the transcript of your ticket.",
  },
  fr: {
    welcome: "Ton ticket #{id} a bien été reçu : un membre de l'équipe va bientôt le prendre en charge.",
    english:
      "Le support se fait en **anglais**. Si tu n'es pas à l'aise en anglais, pas de souci : on trouvera une solution, mais ce sera plus simple si tu écris en anglais.",
    opened: "✅ Ton ticket #{id} est ouvert : {channel}",
    quota: "Tu as déjà {n} ticket(s) en cours. Ferme-en un avant d'en ouvrir un nouveau.",
    noPerm: "⛔ Tu n'as pas la permission de faire ça.",
    wrongChannel: "⚠️ Cette action n'est possible que dans un salon de ticket.",
    closedReply: "🔴 Ticket fermé.",
    reopenedReply: "🟢 Ticket rouvert.",
    error: "❌ Une erreur est survenue, réessaie dans un instant.",
    emptySubject: "Le titre ne peut pas être vide.",
    noticeClosed: "🔴 Ton ticket est fermé. Merci de nous avoir contactés !",
    noticeReopened: "🟢 Ton ticket a été rouvert.",
    modalTitle: "Ouvrir un ticket",
    subjectLabel: "Titre",
    subjectPh: "Ex. : Impossible de me connecter",
    descLabel: "Description détaillée",
    descPh: "Que s'est-il passé ? Que voulais-tu faire ? Messages d'erreur, étapes pour reproduire…",
    panel: "## 🎫 Support\nUn souci, une question ? Clique sur le bouton pour ouvrir un ticket privé avec l'équipe.",
    panelBtn: "Ouvrir un ticket",
    panelPosted: "✅ Panneau posté.",
    cmdTicket: "Ouvrir un ticket de support",
    cmdClose: "Fermer le ticket de ce salon",
    cmdSetup: "Poster le panneau « Ouvrir un ticket » dans ce salon",
    ratingPrompt: "Comment s'est passé ton échange avec le support ? Choisis une note de 1 (mauvais) à 5 (excellent).",
    ratingThanks: "Merci pour ton retour !",
    ratingDone: "Tu as déjà noté ce ticket.",
    transcriptText: "Voici la transcription de ton ticket.",
  },
  es: {
    welcome: "Tu ticket #{id} ha sido recibido: un miembro del equipo lo atenderá en breve.",
    english:
      "El soporte se realiza en **inglés**. Si no te sientes cómodo con el inglés, no te preocupes: encontraremos una solución, pero será más fácil si escribes en inglés.",
    opened: "✅ Tu ticket #{id} está abierto: {channel}",
    quota: "Ya tienes {n} ticket(s) abierto(s). Cierra uno antes de abrir otro.",
    noPerm: "⛔ No tienes permiso para hacer eso.",
    wrongChannel: "⚠️ Esta acción solo está disponible en un canal de ticket.",
    closedReply: "🔴 Ticket cerrado.",
    reopenedReply: "🟢 Ticket reabierto.",
    error: "❌ Ha ocurrido un error, inténtalo de nuevo en un momento.",
    emptySubject: "El título no puede estar vacío.",
    noticeClosed: "🔴 Tu ticket está cerrado. ¡Gracias por contactarnos!",
    noticeReopened: "🟢 Tu ticket ha sido reabierto.",
    modalTitle: "Abrir un ticket",
    subjectLabel: "Título",
    subjectPh: "Ej.: No puedo iniciar sesión",
    descLabel: "Descripción detallada",
    descPh: "¿Qué pasó? ¿Qué querías hacer? Mensajes de error, pasos para reproducirlo…",
    panel: "## 🎫 Soporte\n¿Un problema o una duda? Pulsa el botón para abrir un ticket privado con el equipo.",
    panelBtn: "Abrir un ticket",
    panelPosted: "✅ Panel publicado.",
    cmdTicket: "Abrir un ticket de soporte",
    cmdClose: "Cerrar el ticket de este canal",
    cmdSetup: "Publicar el panel «Abrir un ticket» en este canal",
    ratingPrompt: "¿Qué tal fue la atención recibida? Elige una nota de 1 (mala) a 5 (excelente).",
    ratingThanks: "¡Gracias por tu opinión!",
    ratingDone: "Ya has valorado este ticket.",
    transcriptText: "Aquí tienes la transcripción de tu ticket.",
  },
  de: {
    welcome: "Dein Ticket #{id} ist eingegangen: Ein Teammitglied kümmert sich in Kürze darum.",
    english:
      "Der Support läuft auf **Englisch**. Falls du dich damit nicht wohlfühlst, finden wir eine Lösung – aber es ist einfacher, wenn du auf Englisch schreibst.",
    opened: "✅ Dein Ticket #{id} ist geöffnet: {channel}",
    quota: "Du hast bereits {n} offene(s) Ticket(s). Schließe eines, bevor du ein neues öffnest.",
    noPerm: "⛔ Dafür fehlt dir die Berechtigung.",
    wrongChannel: "⚠️ Diese Aktion ist nur in einem Ticket-Kanal möglich.",
    closedReply: "🔴 Ticket geschlossen.",
    reopenedReply: "🟢 Ticket wieder geöffnet.",
    error: "❌ Es ist ein Fehler aufgetreten, bitte versuche es gleich noch einmal.",
    emptySubject: "Der Titel darf nicht leer sein.",
    noticeClosed: "🔴 Dein Ticket ist geschlossen. Danke, dass du dich gemeldet hast!",
    noticeReopened: "🟢 Dein Ticket wurde wieder geöffnet.",
    modalTitle: "Ticket öffnen",
    subjectLabel: "Titel",
    subjectPh: "z. B. Ich kann mich nicht anmelden",
    descLabel: "Ausführliche Beschreibung",
    descPh: "Was ist passiert? Was wolltest du tun? Fehlermeldungen, Schritte zur Reproduktion…",
    panel: "## 🎫 Support\nEin Problem oder eine Frage? Klicke auf den Button, um ein privates Ticket mit dem Team zu öffnen.",
    panelBtn: "Ticket öffnen",
    panelPosted: "✅ Panel gepostet.",
    cmdTicket: "Ein Support-Ticket öffnen",
    cmdClose: "Das Ticket dieses Kanals schließen",
    cmdSetup: "Das Panel „Ticket öffnen“ in diesem Kanal posten",
    ratingPrompt: "Wie war der Support? Wähle eine Bewertung von 1 (schlecht) bis 5 (ausgezeichnet).",
    ratingThanks: "Danke für dein Feedback!",
    ratingDone: "Du hast dieses Ticket bereits bewertet.",
    transcriptText: "Hier ist das Transkript deines Tickets.",
  },
  pt: {
    welcome: "Seu ticket #{id} foi recebido: um membro da equipe vai atendê-lo em breve.",
    english:
      "O suporte é feito em **inglês**. Se você não se sente à vontade com o inglês, vamos encontrar uma solução, mas será mais fácil se você escrever em inglês.",
    opened: "✅ Seu ticket #{id} está aberto: {channel}",
    quota: "Você já tem {n} ticket(s) aberto(s). Feche um antes de abrir outro.",
    noPerm: "⛔ Você não tem permissão para fazer isso.",
    wrongChannel: "⚠️ Esta ação só está disponível em um canal de ticket.",
    closedReply: "🔴 Ticket fechado.",
    reopenedReply: "🟢 Ticket reaberto.",
    error: "❌ Ocorreu um erro, tente novamente em instantes.",
    emptySubject: "O título não pode estar vazio.",
    noticeClosed: "🔴 Seu ticket foi fechado. Obrigado por entrar em contato!",
    noticeReopened: "🟢 Seu ticket foi reaberto.",
    modalTitle: "Abrir um ticket",
    subjectLabel: "Título",
    subjectPh: "Ex.: Não consigo fazer login",
    descLabel: "Descrição detalhada",
    descPh: "O que aconteceu? O que você queria fazer? Mensagens de erro, passos para reproduzir…",
    panel: "## 🎫 Suporte\nUm problema ou uma dúvida? Clique no botão para abrir um ticket privado com a equipe.",
    panelBtn: "Abrir um ticket",
    panelPosted: "✅ Painel publicado.",
    cmdTicket: "Abrir um ticket de suporte",
    cmdClose: "Fechar o ticket deste canal",
    cmdSetup: "Publicar o painel “Abrir um ticket” neste canal",
    ratingPrompt: "Como foi o atendimento? Escolha uma nota de 1 (ruim) a 5 (excelente).",
    ratingThanks: "Obrigado pelo seu feedback!",
    ratingDone: "Você já avaliou este ticket.",
    transcriptText: "Aqui está a transcrição do seu ticket.",
  },
  it: {
    welcome: "Il tuo ticket #{id} è stato ricevuto: un membro del team se ne occuperà a breve.",
    english:
      "Il supporto è in **inglese**. Se non ti senti a tuo agio con l'inglese, troveremo una soluzione, ma sarà più semplice se scrivi in inglese.",
    opened: "✅ Il tuo ticket #{id} è aperto: {channel}",
    quota: "Hai già {n} ticket aperto/i. Chiudine uno prima di aprirne un altro.",
    noPerm: "⛔ Non hai il permesso di farlo.",
    wrongChannel: "⚠️ Questa azione è disponibile solo in un canale ticket.",
    closedReply: "🔴 Ticket chiuso.",
    reopenedReply: "🟢 Ticket riaperto.",
    error: "❌ Si è verificato un errore, riprova tra un attimo.",
    emptySubject: "Il titolo non può essere vuoto.",
    noticeClosed: "🔴 Il tuo ticket è chiuso. Grazie per averci contattato!",
    noticeReopened: "🟢 Il tuo ticket è stato riaperto.",
    modalTitle: "Apri un ticket",
    subjectLabel: "Titolo",
    subjectPh: "Es.: Non riesco ad accedere",
    descLabel: "Descrizione dettagliata",
    descPh: "Cos'è successo? Cosa volevi fare? Messaggi di errore, passaggi per riprodurlo…",
    panel: "## 🎫 Supporto\nUn problema o una domanda? Clicca il pulsante per aprire un ticket privato con il team.",
    panelBtn: "Apri un ticket",
    panelPosted: "✅ Pannello pubblicato.",
    cmdTicket: "Apri un ticket di supporto",
    cmdClose: "Chiudi il ticket di questo canale",
    cmdSetup: "Pubblica il pannello «Apri un ticket» in questo canale",
    ratingPrompt: "Com'è andata con il supporto? Scegli un voto da 1 (scarso) a 5 (eccellente).",
    ratingThanks: "Grazie per il tuo feedback!",
    ratingDone: "Hai già valutato questo ticket.",
    transcriptText: "Ecco la trascrizione del tuo ticket.",
  },
  nl: {
    welcome: "Je ticket #{id} is ontvangen: een teamlid pakt het binnenkort op.",
    english:
      "Support verloopt in het **Engels**. Voel je je daar niet prettig bij, dan vinden we een oplossing, maar het gaat makkelijker als je in het Engels schrijft.",
    opened: "✅ Je ticket #{id} is geopend: {channel}",
    quota: "Je hebt al {n} open ticket(s). Sluit er een voordat je een nieuw opent.",
    noPerm: "⛔ Je hebt hier geen toestemming voor.",
    wrongChannel: "⚠️ Deze actie kan alleen in een ticketkanaal.",
    closedReply: "🔴 Ticket gesloten.",
    reopenedReply: "🟢 Ticket heropend.",
    error: "❌ Er ging iets mis, probeer het zo nog eens.",
    emptySubject: "De titel mag niet leeg zijn.",
    noticeClosed: "🔴 Je ticket is gesloten. Bedankt dat je contact met ons opnam!",
    noticeReopened: "🟢 Je ticket is heropend.",
    modalTitle: "Ticket openen",
    subjectLabel: "Titel",
    subjectPh: "Bijv.: Ik kan niet inloggen",
    descLabel: "Uitgebreide beschrijving",
    descPh: "Wat is er gebeurd? Wat wilde je doen? Foutmeldingen, stappen om het te reproduceren…",
    panel: "## 🎫 Support\nEen probleem of een vraag? Klik op de knop om een privéticket met het team te openen.",
    panelBtn: "Ticket openen",
    panelPosted: "✅ Paneel geplaatst.",
    cmdTicket: "Een supportticket openen",
    cmdClose: "Het ticket van dit kanaal sluiten",
    cmdSetup: "Het paneel “Ticket openen” in dit kanaal plaatsen",
    ratingPrompt: "Hoe was de ondersteuning? Kies een cijfer van 1 (slecht) tot 5 (uitstekend).",
    ratingThanks: "Bedankt voor je feedback!",
    ratingDone: "Je hebt dit ticket al beoordeeld.",
    transcriptText: "Hier is het transcript van je ticket.",
  },
  pl: {
    welcome: "Twoje zgłoszenie #{id} zostało odebrane: członek zespołu zajmie się nim wkrótce.",
    english:
      "Obsługa odbywa się po **angielsku**. Jeśli nie czujesz się swobodnie w tym języku, znajdziemy rozwiązanie, ale będzie łatwiej, jeśli napiszesz po angielsku.",
    opened: "✅ Twoje zgłoszenie #{id} jest otwarte: {channel}",
    quota: "Masz już {n} otwarte zgłoszenie(a). Zamknij jedno, zanim otworzysz nowe.",
    noPerm: "⛔ Nie masz uprawnień, aby to zrobić.",
    wrongChannel: "⚠️ Ta akcja jest dostępna tylko na kanale zgłoszenia.",
    closedReply: "🔴 Zgłoszenie zamknięte.",
    reopenedReply: "🟢 Zgłoszenie otwarte ponownie.",
    error: "❌ Wystąpił błąd, spróbuj ponownie za chwilę.",
    emptySubject: "Tytuł nie może być pusty.",
    noticeClosed: "🔴 Twoje zgłoszenie zostało zamknięte. Dziękujemy za kontakt!",
    noticeReopened: "🟢 Twoje zgłoszenie zostało otwarte ponownie.",
    modalTitle: "Otwórz zgłoszenie",
    subjectLabel: "Tytuł",
    subjectPh: "Np. Nie mogę się zalogować",
    descLabel: "Szczegółowy opis",
    descPh: "Co się stało? Co chciałeś zrobić? Komunikaty o błędach, kroki do odtworzenia…",
    panel: "## 🎫 Wsparcie\nMasz problem lub pytanie? Kliknij przycisk, aby otworzyć prywatne zgłoszenie do zespołu.",
    panelBtn: "Otwórz zgłoszenie",
    panelPosted: "✅ Panel opublikowany.",
    cmdTicket: "Otwórz zgłoszenie do wsparcia",
    cmdClose: "Zamknij zgłoszenie na tym kanale",
    cmdSetup: "Opublikuj panel „Otwórz zgłoszenie” na tym kanale",
    ratingPrompt: "Jak oceniasz pomoc? Wybierz ocenę od 1 (słabo) do 5 (doskonale).",
    ratingThanks: "Dziękujemy za opinię!",
    ratingDone: "Ten ticket został już oceniony.",
    transcriptText: "Oto transkrypcja Twojego zgłoszenia.",
  },
  ru: {
    welcome: "Ваше обращение #{id} получено: скоро им займётся сотрудник команды.",
    english:
      "Поддержка ведётся на **английском**. Если вам неудобно писать по-английски, мы найдём решение, но так будет проще.",
    opened: "✅ Ваше обращение #{id} открыто: {channel}",
    quota: "У вас уже есть открытых обращений: {n}. Закройте одно, прежде чем открывать новое.",
    noPerm: "⛔ У вас нет прав на это действие.",
    wrongChannel: "⚠️ Это действие доступно только в канале обращения.",
    closedReply: "🔴 Обращение закрыто.",
    reopenedReply: "🟢 Обращение открыто снова.",
    error: "❌ Произошла ошибка, попробуйте ещё раз чуть позже.",
    emptySubject: "Заголовок не может быть пустым.",
    noticeClosed: "🔴 Ваше обращение закрыто. Спасибо, что связались с нами!",
    noticeReopened: "🟢 Ваше обращение снова открыто.",
    modalTitle: "Открыть обращение",
    subjectLabel: "Заголовок",
    subjectPh: "Напр.: Не могу войти в аккаунт",
    descLabel: "Подробное описание",
    descPh: "Что произошло? Что вы хотели сделать? Сообщения об ошибках, шаги для воспроизведения…",
    panel: "## 🎫 Поддержка\nПроблема или вопрос? Нажмите кнопку, чтобы открыть личное обращение к команде.",
    panelBtn: "Открыть обращение",
    panelPosted: "✅ Панель опубликована.",
    cmdTicket: "Открыть обращение в поддержку",
    cmdClose: "Закрыть обращение в этом канале",
    cmdSetup: "Опубликовать панель «Открыть обращение» в этом канале",
    ratingPrompt: "Как вам поддержка? Выберите оценку от 1 (плохо) до 5 (отлично).",
    ratingThanks: "Спасибо за отзыв!",
    ratingDone: "Вы уже оценили это обращение.",
    transcriptText: "Вот расшифровка вашего обращения.",
  },
  tr: {
    welcome: "#{id} numaralı talebin alındı: ekibimizden biri kısa süre içinde ilgilenecek.",
    english:
      "Destek **İngilizce** verilmektedir. İngilizce konuşmakta rahat değilsen bir çözüm buluruz, ancak İngilizce yazarsan daha kolay olur.",
    opened: "✅ #{id} numaralı talebin açıldı: {channel}",
    quota: "Zaten {n} açık talebin var. Yenisini açmadan önce birini kapat.",
    noPerm: "⛔ Bunu yapmaya iznin yok.",
    wrongChannel: "⚠️ Bu işlem yalnızca talep kanalında yapılabilir.",
    closedReply: "🔴 Talep kapatıldı.",
    reopenedReply: "🟢 Talep yeniden açıldı.",
    error: "❌ Bir hata oluştu, lütfen birazdan tekrar dene.",
    emptySubject: "Başlık boş olamaz.",
    noticeClosed: "🔴 Talebin kapatıldı. Bize ulaştığın için teşekkürler!",
    noticeReopened: "🟢 Talebin yeniden açıldı.",
    modalTitle: "Talep aç",
    subjectLabel: "Başlık",
    subjectPh: "Örn.: Giriş yapamıyorum",
    descLabel: "Ayrıntılı açıklama",
    descPh: "Ne oldu? Ne yapmak istiyordun? Hata mesajları, sorunu yeniden üretme adımları…",
    panel: "## 🎫 Destek\nBir problemin ya da sorun mu var? Ekiple özel bir talep açmak için düğmeye tıkla.",
    panelBtn: "Talep aç",
    panelPosted: "✅ Panel gönderildi.",
    cmdTicket: "Bir destek talebi aç",
    cmdClose: "Bu kanaldaki talebi kapat",
    cmdSetup: "“Talep aç” panelini bu kanala gönder",
    ratingPrompt: "Destek nasıldı? 1 (kötü) ile 5 (mükemmel) arasında bir puan seç.",
    ratingThanks: "Geri bildirimin için teşekkürler!",
    ratingDone: "Bu bileti zaten puanladın.",
    transcriptText: "Biletinin dökümü burada.",
  },
  ja: {
    welcome: "チケット #{id} を受け付けました。まもなく担当者が対応します。",
    english: "サポートは**英語**で行います。英語が難しい場合は解決策を一緒に探しますが、英語でご連絡いただけるとスムーズです。",
    opened: "✅ チケット #{id} を作成しました: {channel}",
    quota: "すでに {n} 件のチケットが開いています。新しく開く前に、どれか1件を閉じてください。",
    noPerm: "⛔ この操作を行う権限がありません。",
    wrongChannel: "⚠️ この操作はチケットのチャンネルでのみ使えます。",
    closedReply: "🔴 チケットを閉じました。",
    reopenedReply: "🟢 チケットを再開しました。",
    error: "❌ エラーが発生しました。しばらくしてからもう一度お試しください。",
    emptySubject: "タイトルを入力してください。",
    noticeClosed: "🔴 チケットを閉じました。お問い合わせありがとうございました！",
    noticeReopened: "🟢 チケットを再開しました。",
    modalTitle: "チケットを作成",
    subjectLabel: "タイトル",
    subjectPh: "例：ログインできません",
    descLabel: "詳細な説明",
    descPh: "何が起きましたか？ 何をしようとしていましたか？ エラーメッセージや再現手順など",
    panel: "## 🎫 サポート\n問題や質問がありますか？ ボタンを押すと、チームとの非公開チケットが作成されます。",
    panelBtn: "チケットを作成",
    panelPosted: "✅ パネルを投稿しました。",
    cmdTicket: "サポートチケットを作成する",
    cmdClose: "このチャンネルのチケットを閉じる",
    cmdSetup: "「チケットを作成」パネルをこのチャンネルに投稿する",
    ratingPrompt: "サポートはいかがでしたか？1（悪い）から5（とても良い）で評価してください。",
    ratingThanks: "ご意見ありがとうございます！",
    ratingDone: "このチケットはすでに評価済みです。",
    transcriptText: "チケットの記録はこちらです。",
  },
  ko: {
    welcome: "티켓 #{id}이(가) 접수되었습니다. 곧 팀원이 담당할 예정입니다.",
    english: "지원은 **영어**로 진행됩니다. 영어가 불편하시면 해결 방법을 찾아드리겠지만, 영어로 작성해 주시면 더 수월합니다.",
    opened: "✅ 티켓 #{id}이(가) 열렸습니다: {channel}",
    quota: "이미 열려 있는 티켓이 {n}개 있습니다. 새 티켓을 열기 전에 하나를 닫아 주세요.",
    noPerm: "⛔ 이 작업을 수행할 권한이 없습니다.",
    wrongChannel: "⚠️ 이 작업은 티켓 채널에서만 할 수 있습니다.",
    closedReply: "🔴 티켓을 닫았습니다.",
    reopenedReply: "🟢 티켓을 다시 열었습니다.",
    error: "❌ 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
    emptySubject: "제목을 입력해 주세요.",
    noticeClosed: "🔴 티켓이 닫혔습니다. 문의해 주셔서 감사합니다!",
    noticeReopened: "🟢 티켓이 다시 열렸습니다.",
    modalTitle: "티켓 열기",
    subjectLabel: "제목",
    subjectPh: "예: 로그인이 되지 않습니다",
    descLabel: "상세 설명",
    descPh: "무슨 일이 있었나요? 무엇을 하려고 했나요? 오류 메시지, 재현 방법 등",
    panel: "## 🎫 지원\n문제나 질문이 있으신가요? 버튼을 눌러 팀과의 비공개 티켓을 열어 보세요.",
    panelBtn: "티켓 열기",
    panelPosted: "✅ 패널을 게시했습니다.",
    cmdTicket: "지원 티켓 열기",
    cmdClose: "이 채널의 티켓 닫기",
    cmdSetup: "이 채널에 '티켓 열기' 패널 게시하기",
    ratingPrompt: "지원은 어떠셨나요? 1(나쁨)에서 5(매우 좋음) 중에서 선택해 주세요.",
    ratingThanks: "의견 감사합니다!",
    ratingDone: "이미 이 티켓을 평가하셨습니다.",
    transcriptText: "티켓 대화 기록입니다.",
  },
  zh: {
    welcome: "你的工单 #{id} 已收到，团队成员很快会接手处理。",
    english: "我们的支持以**英语**进行。如果你不方便使用英语，我们会想办法解决，但用英语沟通会更顺畅。",
    opened: "✅ 你的工单 #{id} 已创建：{channel}",
    quota: "你已有 {n} 个未关闭的工单。请先关闭一个，再创建新的。",
    noPerm: "⛔ 你没有权限执行此操作。",
    wrongChannel: "⚠️ 此操作只能在工单频道中进行。",
    closedReply: "🔴 工单已关闭。",
    reopenedReply: "🟢 工单已重新打开。",
    error: "❌ 出错了，请稍后再试。",
    emptySubject: "标题不能为空。",
    noticeClosed: "🔴 你的工单已关闭。感谢你联系我们！",
    noticeReopened: "🟢 你的工单已重新打开。",
    modalTitle: "创建工单",
    subjectLabel: "标题",
    subjectPh: "例如：无法登录",
    descLabel: "详细描述",
    descPh: "发生了什么？你想做什么？错误信息、复现步骤等",
    panel: "## 🎫 支持\n遇到问题或有疑问？点击按钮，与团队创建一个私密工单。",
    panelBtn: "创建工单",
    panelPosted: "✅ 面板已发布。",
    cmdTicket: "创建支持工单",
    cmdClose: "关闭此频道的工单",
    cmdSetup: "在此频道发布“创建工单”面板",
    ratingPrompt: "本次支持体验如何？请在 1（差）到 5（非常好）之间打分。",
    ratingThanks: "感谢你的反馈！",
    ratingDone: "你已经评价过这个工单了。",
    transcriptText: "这是您的工单记录。",
  },
};

/** « fr », « en-US », « zh-TW »… -> langue gérée (anglais par défaut). */
export function langOf(locale?: string): string {
  const base = (locale ?? "").toLowerCase().split("-")[0] ?? "";
  return base in PACKS ? base : "en";
}

export const pack = (locale?: string): Pack => PACKS[langOf(locale)]!;

const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(v[k]));

/** Message d'accueil du salon : mention, accueil, puis (hors anglais) l'avertissement sur la langue du support. */
export function welcomeText(locale: string | undefined, ticketId: number, userId: string): string {
  const p = pack(locale);
  const head = `🎫 <@${userId}> ${fill(p.welcome, { id: ticketId })}`;
  return p.english ? `${head}\n\n🌐 ${p.english}` : head;
}

/** Réponse éphémère après l'envoi de la modale. */
export function openedText(locale: string | undefined, ticketId: number, channelId: string): string {
  return fill(pack(locale).opened, { id: ticketId, channel: `<#${channelId}>` });
}

export const quotaText = (locale: string | undefined, n: number): string => fill(pack(locale).quota, { n });

/** Codes de locale Discord pour chaque langue gérée (l'anglais est la description par défaut). */
const DISCORD_LOCALES: Record<string, string[]> = {
  fr: ["fr"], es: ["es-ES", "es-419"], de: ["de"], pt: ["pt-BR"], it: ["it"], nl: ["nl"], pl: ["pl"],
  ru: ["ru"], tr: ["tr"], ja: ["ja"], ko: ["ko"], zh: ["zh-CN", "zh-TW"],
};

/** Descriptions localisées d'une commande slash, au format attendu par Discord. */
export function commandLocalizations(key: "cmdTicket" | "cmdClose" | "cmdSetup"): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [lang, codes] of Object.entries(DISCORD_LOCALES)) for (const c of codes) out[c] = PACKS[lang]![key];
  return out;
}

/**
 * Panneau « Ouvrir un ticket » posté par /setup : toujours en anglais, quelles que soient les langues
 * du serveur et de l'admin (c'est un message public, pas une réponse à un utilisateur).
 */
export const SETUP_EN = {
  title: "Stuck? Open a ticket.",
  description:
    "Describe the problem. A private channel opens for you and the team, and every reply reaches you right here on Discord.",
  fields: [
    { name: "Private", value: "Only you and the team can read it." },
    { name: "Your language", value: "Write in yours. Replies come in English." },
    { name: "Files welcome", value: "Screenshots, logs and documents." },
  ],
  footer: "One open ticket per person.",
  button: "Open a ticket",
} as const;
