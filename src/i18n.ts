/** Textes vus par l'utilisateur sur Discord, selon sa langue (`interaction.locale`). Le support, lui, se fait en anglais. */

type Pack = {
  /** `{id}` : numéro du ticket. */
  welcome: string;
  /** Prévient que l'échange se fera en anglais ; absent pour l'anglais. */
  english?: string;
  /** `{id}` : numéro du ticket, `{channel}` : salon. */
  opened: string;
};

const PACKS: Record<string, Pack> = {
  en: {
    welcome: "Your ticket #{id} has been received: a team member will pick it up shortly.",
    opened: "✅ Your ticket #{id} is open: {channel}",
  },
  fr: {
    welcome: "Ton ticket #{id} a bien été reçu : un membre de l'équipe va bientôt le prendre en charge.",
    english:
      "Le support se fait en **anglais**. Si tu n'es pas à l'aise en anglais, pas de souci : on trouvera une solution, mais ce sera plus simple si tu écris en anglais.",
    opened: "✅ Ton ticket #{id} est ouvert : {channel}",
  },
  es: {
    welcome: "Tu ticket #{id} ha sido recibido: un miembro del equipo lo atenderá en breve.",
    english:
      "El soporte se realiza en **inglés**. Si no te sientes cómodo con el inglés, no te preocupes: encontraremos una solución, pero será más fácil si escribes en inglés.",
    opened: "✅ Tu ticket #{id} está abierto: {channel}",
  },
  de: {
    welcome: "Dein Ticket #{id} ist eingegangen: Ein Teammitglied kümmert sich in Kürze darum.",
    english:
      "Der Support läuft auf **Englisch**. Falls du dich damit nicht wohlfühlst, finden wir eine Lösung – aber es ist einfacher, wenn du auf Englisch schreibst.",
    opened: "✅ Dein Ticket #{id} ist geöffnet: {channel}",
  },
  pt: {
    welcome: "Seu ticket #{id} foi recebido: um membro da equipe vai atendê-lo em breve.",
    english:
      "O suporte é feito em **inglês**. Se você não se sente à vontade com o inglês, vamos encontrar uma solução, mas será mais fácil se você escrever em inglês.",
    opened: "✅ Seu ticket #{id} está aberto: {channel}",
  },
  it: {
    welcome: "Il tuo ticket #{id} è stato ricevuto: un membro del team se ne occuperà a breve.",
    english:
      "Il supporto è in **inglese**. Se non ti senti a tuo agio con l'inglese, troveremo una soluzione, ma sarà più semplice se scrivi in inglese.",
    opened: "✅ Il tuo ticket #{id} è aperto: {channel}",
  },
  nl: {
    welcome: "Je ticket #{id} is ontvangen: een teamlid pakt het binnenkort op.",
    english:
      "Support verloopt in het **Engels**. Voel je je daar niet prettig bij, dan vinden we een oplossing, maar het gaat makkelijker als je in het Engels schrijft.",
    opened: "✅ Je ticket #{id} is geopend: {channel}",
  },
  pl: {
    welcome: "Twoje zgłoszenie #{id} zostało odebrane: członek zespołu zajmie się nim wkrótce.",
    english:
      "Obsługa odbywa się po **angielsku**. Jeśli nie czujesz się swobodnie w tym języku, znajdziemy rozwiązanie, ale będzie łatwiej, jeśli napiszesz po angielsku.",
    opened: "✅ Twoje zgłoszenie #{id} jest otwarte: {channel}",
  },
  ru: {
    welcome: "Ваше обращение #{id} получено: скоро им займётся сотрудник команды.",
    english:
      "Поддержка ведётся на **английском**. Если вам неудобно писать по-английски, мы найдём решение, но так будет проще.",
    opened: "✅ Ваше обращение #{id} открыто: {channel}",
  },
  tr: {
    welcome: "#{id} numaralı talebin alındı: ekibimizden biri kısa süre içinde ilgilenecek.",
    english:
      "Destek **İngilizce** verilmektedir. İngilizce konuşmakta rahat değilsen bir çözüm buluruz, ancak İngilizce yazarsan daha kolay olur.",
    opened: "✅ #{id} numaralı talebin açıldı: {channel}",
  },
  ja: {
    welcome: "チケット #{id} を受け付けました。まもなく担当者が対応します。",
    english: "サポートは**英語**で行います。英語が難しい場合は解決策を一緒に探しますが、英語でご連絡いただけるとスムーズです。",
    opened: "✅ チケット #{id} を作成しました: {channel}",
  },
  ko: {
    welcome: "티켓 #{id}이(가) 접수되었습니다. 곧 팀원이 담당할 예정입니다.",
    english: "지원은 **영어**로 진행됩니다. 영어가 불편하시면 해결 방법을 찾아드리겠지만, 영어로 작성해 주시면 더 수월합니다.",
    opened: "✅ 티켓 #{id}이(가) 열렸습니다: {channel}",
  },
  zh: {
    welcome: "你的工单 #{id} 已收到，团队成员很快会接手处理。",
    english: "我们的支持以**英语**进行。如果你不方便使用英语，我们会想办法解决，但用英语沟通会更顺畅。",
    opened: "✅ 你的工单 #{id} 已创建：{channel}",
  },
};

/** « fr », « en-US », « zh-TW »… -> langue gérée (anglais par défaut). */
export function langOf(locale?: string): string {
  const base = (locale ?? "").toLowerCase().split("-")[0] ?? "";
  return base in PACKS ? base : "en";
}

const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(v[k]));

/** Message d'accueil du salon : mention, accueil, puis (hors anglais) l'avertissement sur la langue du support. */
export function welcomeText(locale: string | undefined, ticketId: number, userId: string): string {
  const p = PACKS[langOf(locale)]!;
  const head = `🎫 <@${userId}> ${fill(p.welcome, { id: ticketId })}`;
  return p.english ? `${head}\n\n🌐 ${p.english}` : head;
}

/** Réponse éphémère après l'envoi de la modale. */
export function openedText(locale: string | undefined, ticketId: number, channelId: string): string {
  return fill(PACKS[langOf(locale)]!.opened, { id: ticketId, channel: `<#${channelId}>` });
}
