/**
 * The FAQ page's questions and answers, written for LFR owners in plain
 * English. Words between double asterisks are shown in bold: use them for the
 * names of buttons, pages and settings exactly as they appear on screen, so a
 * receiver can find them. When a screen changes, check its answers here.
 */

/** A paragraph, numbered steps, or a bulleted list. */
export type FaqBlock = string | { steps: string[] } | { points: string[] };

export interface FaqQuestion {
  id: string;
  question: string;
  answer: FaqBlock[];
  /** Questions in other groups that also answer this one. */
  seeAlso?: string[];
}

export interface FaqGroup {
  id: string;
  title: string;
  summary: string;
  questions: FaqQuestion[];
}

export const FAQ_GROUPS: FaqGroup[] = [
  {
    id: 'before-you-start',
    title: 'Before you start',
    summary: 'Installing myLFR and setting up your business.',
    questions: [
      {
        id: 'what-is-mylfr',
        question: 'What does myLFR do?',
        answer: [
          'myLFR keeps a record of the fish you receive as a Licensed Fish Receiver. You keep your permit holders and their vessels in it, record each landing, and it adds up your monthly totals ready for your return.',
          'myLFR is free. It never files or sends anything for you: you still check the figures and file your return yourself.',
        ],
      },
      {
        id: 'what-do-i-need',
        question: 'What do I need to run myLFR?',
        answer: [
          'A Windows computer running Windows 11, or Windows 10. myLFR works without the internet. You only need a connection to check for updates and to open the links on the **Resources** page.',
        ],
      },
      {
        id: 'install',
        question: 'Where do I get myLFR, and how do I install it?',
        answer: [
          'Download myLFR only from its Releases page on GitHub: github.com/Magnifica101/myLFR-desktop/releases. Don\'t install a copy someone has emailed you or that came from another website.',
          {
            steps: [
              'On the Releases page, download the installer (the file ending in **.exe**) from the newest release.',
              'Open your Downloads folder and double-click the installer.',
              'Follow the steps on screen.',
              'Open **myLFR Desktop** from the Start menu.',
            ],
          },
          'myLFR installs for your own Windows sign-in, not for everyone who uses the computer.',
        ],
        seeAlso: ['security-warning'],
      },
      {
        id: 'security-warning',
        question: 'Windows showed a warning when I ran the installer. Is it safe?',
        answer: [
          'Yes, if you downloaded it from the myLFR Releases page on GitHub. myLFR is free and isn\'t signed with a paid certificate, so Windows doesn\'t know who made it. It shows a blue **Windows protected your PC** screen that says **Unknown publisher**. This is expected for myLFR.',
          {
            steps: [
              'Check that you downloaded the installer from github.com/Magnifica101/myLFR-desktop/releases.',
              'On the blue screen, choose **More info**.',
              'Check that the app name is the installer you downloaded, then choose **Run anyway**.',
            ],
          },
          'If Windows blocks the installer and there\'s no **Run anyway**, a security setting such as Smart App Control, or your workplace\'s rules, is stopping it. Ask whoever looks after your computer before changing any security setting.',
          'Never run a myLFR installer that someone emailed you or that came from another website.',
        ],
      },
      {
        id: 'edit-business-details',
        question: 'How do I change my business details?',
        answer: [
          {
            steps: [
              'Go to **Settings**. Under **Your business**, find **Business details**.',
              'Choose **Edit details**.',
              'Change your **LFR name**, **Fishserve Client Number** or address.',
              'Choose **Save business details**. To leave things as they were, choose **Cancel**.',
            ],
          },
          'Your **LFR name** appears on your reports, so check it is right before you print or save one.',
        ],
        seeAlso: ['add-logo'],
      },
      {
        id: 'add-logo',
        question: 'Can I put my logo on my reports?',
        answer: [
          'Yes. Go to **Settings**, find **Your logo**, and choose **Choose logo**. Pick a picture file of your logo. It appears beside the title on your PDF reports. Large pictures are made smaller automatically.',
          'To change it, choose **Replace logo**. To take it off, choose **Remove logo**.',
        ],
      },
    ],
  },
  {
    id: 'every-landing',
    title: 'Every landing',
    summary: 'Permit holders, vessels, fishstocks, and recording and fixing landings.',
    questions: [
      {
        id: 'add-permit-holder',
        question: 'How do I add a permit holder and their vessels?',
        answer: [
          'You need at least one permit holder before you can record a landing.',
          {
            steps: [
              'Go to **Permit holders** and choose **Add permit holder**.',
              'Enter their **Name** and **Permit number**.',
              'For each vessel they use, choose **Add vessel** and enter the **Vessel registration number**. Use digits only, starting with 1–9. If the vessel already exists, choose **Use this vessel**; otherwise enter its name.',
              'Choose **Save permit holder**.',
            ],
          },
          'If they land from shore with no vessel, don\'t add one. You can choose **Shore-based / no vessel** when you record their landings.',
          'To take off a vessel you\'ve just added, choose **Remove**.',
          'To change their details or vessels later, find them on **Permit holders**, choose their name to show their details, and choose **Edit**.',
        ],
      },
      {
        id: 'shared-vessel',
        question: 'What if a vessel fishes for two permit holders, or is sold?',
        answer: [
          'A registration number identifies one vessel. The same vessel can be linked to more than one permit holder; its name is not used for matching.',
          'Edit the new permit holder, choose **Add vessel**, enter the registration number, then choose **Use this vessel** and **Save permit holder**. Each landing still records the permit holder it was landed for.',
          'If the vessel stops fishing for the previous permit holder, edit that permit holder, choose **Archive** beside the vessel, confirm **Archive vessel**, then choose **Save permit holder**. This archives only that link. Other permit holders can keep recording landings for the same vessel.',
          'To restore a link, tick **Include archived vessels** in the editor, choose **Restore**, then **Save permit holder**. All historical landings stay with their original permit holders.',
        ],
        seeAlso: ['add-permit-holder', 'archive-permit-holder'],
      },
      {
        id: 'record-landing',
        question: 'How do I record a landing?',
        answer: [
          {
            steps: [
              'Go to **Landings** and choose **Record a landing**.',
              'Choose the **Permit holder**, then the **Vessel**, or **Shore-based / no vessel**.',
              'Check the **Received date**. It starts as today.',
              'Enter the **Invoice number** if you have one. You can leave it empty.',
              'Add each fishstock you received, using the search box under **Add fishstock**.',
              'Enter the weight or count for each fishstock.',
              'Choose **Save landing**.',
            ],
          },
          'To save time, **Add from previous landing** adds the fishstocks from the last landing by the same permit holder and vessel, and **Add from favourites** lets you pick from the fishstocks you use most.',
        ],
        seeAlso: ['enter-weight', 'find-fishstock', 'favourites'],
      },
      {
        id: 'enter-weight',
        question: 'How do I enter the weight?',
        answer: [
          'The label above each box tells you what to enter for that fishstock:',
          {
            points: [
              '**Greenweight (kg)**: most fishstocks. Enter kilograms, with up to two decimal places, such as 125 or 125.5 or 125.55.',
              '**Meatweight (kg)**: Enter kilograms of meat, with up to two decimal places.',
              '**Count**: Enter the number as a whole number.',
            ],
          },
          'myLFR keeps weights to two decimal places. **Home** rounds kilogram totals to whole kilograms to keep them easy to read, but your reports show the figures to two decimal places.',
        ],
      },
      {
        id: 'find-fishstock',
        question: 'How do I find the right fishstock?',
        answer: [
          'Type part of the code or the name into the search box, such as **SNA** or **snapper**, then choose the fishstock from the list. To take one off the landing, choose the **bin** beside it.',
          'You can also search the full list on the **Species** page.',
        ],
        seeAlso: ['missing-fishstock'],
      },
      {
        id: 'favourites',
        question: 'How do I save the fishstocks I use most?',
        answer: [
          'Make them favourites. Go to **Species**, search for the fishstock, and choose the **star** beside it. Choose the **star** again to remove it.',
          'When you record a landing, choose **Add from favourites** and pick the codes you need.',
        ],
      },
      {
        id: 'missing-fishstock',
        question: 'A fishstock I need isn\'t in the list. What do I do?',
        answer: [
          'myLFR starts with an extensive list of fishstocks. That list doesn’t change when you install an app update. If one you need isn’t there, you can add it yourself.',
          {
            steps: [
              'Go to **Species** and choose **Add a fishstock**.',
              'Enter the **Fishstock code** and its **Name**.',
              'Choose **How it\'s measured**.',
              'Choose its **Fishing year**. If you\'re not sure, check with Fisheries New Zealand first.',
              'Choose **Add fishstock**.',
            ],
          },
          'If myLFR finds a fishstock that looks similar, it shows it to you first, in case you meant that one.',
          'Fishstocks you add are labelled **Added by you**. You can change their name and fishing year at any time. Once a landing uses one, its code and how it\'s measured can\'t be changed, and it can\'t be removed.',
        ],
      },
      {
        id: 'fix-landing',
        question: 'I made a mistake on a landing. How do I fix it?',
        answer: [
          {
            steps: [
              'Go to **Landings**. The 10 most recent landings are shown. For an older one, use **Search landings**.',
              'Choose **Edit** (the pencil) beside the landing.',
              'Make your changes and choose **Save landing**.',
            ],
          },
          'myLFR keeps every version of a landing. To see what changed and when, choose **History** (the clock) beside it.',
        ],
        seeAlso: ['find-landing'],
      },
      {
        id: 'delete-landing',
        question: 'How do I delete a landing?',
        answer: [
          'Choose **Delete** (the bin) beside the landing on **Landings**, then confirm. The landing is taken out of your totals and reports.',
          'A read-only copy is kept for your records. To see deleted landings, open **Search landings**, tick **Include archived (deleted) landings**, and choose **Search**. Choose **View details** (the eye) beside one to see everything it held.',
          'A deleted landing can\'t be brought back. If you deleted the wrong one, record it again.',
        ],
      },
      {
        id: 'find-landing',
        question: 'How do I find an older landing?',
        answer: [
          'On **Landings**, choose **Search landings**. Fill in any of the dates, the permit holder, the vessel, a fishstock code such as SNA1, or any part of an **Invoice number**, then choose **Search**. Leave a box empty to include everything. **Clear filters** starts again.',
        ],
      },
      {
        id: 'archive-permit-holder',
        question: 'A permit holder has stopped landing with me. What should I do?',
        answer: [
          'Archive them. Find them on **Permit holders**, choose their name to show their details, choose **Archive**, then confirm with **Archive** in the popup. They no longer appear when you record a landing, but all their landings are kept and still count in your reports.',
          'To see archived permit holders, tick **Show archived permit holders**. To bring one back, choose **Restore**.',
          'You can only remove a permit holder completely if they have never had a landing.',
        ],
      },
    ],
  },
  {
    id: 'return-day',
    title: 'Return day (the 15th)',
    summary: 'Getting your monthly figures and checking them before you file.',
    questions: [
      {
        id: 'when-due',
        question: 'When is my return due?',
        answer: [
          'Your Licensed Fish Receiver Return is due with FishServe no later than the 15th of each month, for the month before. **Home** shows how many days are left.',
        ],
      },
      {
        id: 'monthly-figures',
        question: 'How do I get my figures for the return?',
        answer: [
          {
            steps: [
              'Go to **Monthly summaries**. It opens on last month.',
              'Check the **Month** and **Year**.',
              'Choose a **Permit holder**.',
            ],
          },
          'The totals are grouped by fish type: the first three letters of the fishstock code, such as SNA for snapper. The fishstocks in each group are listed beside it.',
        ],
        seeAlso: ['save-summary', 'check-figures'],
      },
      {
        id: 'files-return',
        question: 'Does myLFR file my return for me?',
        answer: [
          'No. myLFR adds up your figures, but it never files or sends anything. Check its figures against your own records, then file your return with FishServe yourself. You remain responsible for your return being right and on time.',
        ],
      },
      {
        id: 'save-summary',
        question: 'How do I save or print the summary?',
        answer: [
          'Choose **PDF** or **Excel** above the totals, then choose where to save the file. To print, open the PDF and print it from there.',
        ],
        seeAlso: ['add-logo', 'pdf-or-excel'],
      },
      {
        id: 'pdf-or-excel',
        question: 'Should I save the monthly summary as a PDF or as Excel?',
        answer: [
          'They suit different jobs:',
          {
            points: [
              '**PDF** is a tidy summary to print, keep with your records or send to a permit holder. It has your business details and logo, the permit holder, and their totals for the month by fish type.',
              '**Excel** has more detail. The first sheet has monthly totals by fish type. There are also sheets for each vessel, with that vessel\'s totals and a line for every fishstock on each of its landings, with the date and invoice number.',
            ],
          },
        ],
        seeAlso: ['check-figures'],
      },
      {
        id: 'export-data',
        question: 'How do I get my landings into Excel for my own analysis?',
        answer: [
          {
            steps: [
              'Go to **Export data**.',
              'Choose the **From** and **To** dates, or leave them empty to include every landing.',
              'To include just one permit holder, choose them under **Permit holder**, and then a **Vessel** if you want just one.',
              'To narrow it further, choose **Fishstocks** or a **Quantity type**.',
              'Choose **Save as Excel**.',
            ],
          },
          'The charts on the page show exactly the landings in your file. The file has one row for each fishstock on each landing, ready for a pivot table. Use the **Unit** column in your pivot table, so kilograms and counts are never added together.',
        ],
      },
      {
        id: 'check-figures',
        question: 'The figures don\'t match my own records. What should I check?',
        answer: [
          {
            points: [
              'Use **Search landings** for that month and fishstock, and check each landing against your invoices.',
              'Check the **Received date** on each landing. A landing counts in the month of its received date.',
              'Check whether a landing was deleted by mistake: tick **Include archived (deleted) landings** when you search.',
              'Check that the right unit was used: greenweight, meatweight or count.',
            ],
          },
          'Fix any mistakes, then open **Monthly summaries** again.',
        ],
        seeAlso: ['fix-landing'],
      },
    ],
  },
  {
    id: 'new-fishing-year',
    title: 'New fishing year',
    summary: 'The three fishing years and what they change on Home.',
    questions: [
      {
        id: 'three-years',
        question: 'Why are there three fishing years?',
        answer: [
          'Not every fishstock uses the same fishing year:',
          {
            points: [
              '**1 October – 30 September**: most fishstocks.',
              '**1 April – 31 March**: rock lobster, southern blue whiting, scallops, and some other shellfish and crabs.',
              '**1 February – 31 January**: shortfin and longfin eels at Lake Ellesmere (Te Waihora) only.',
            ],
          },
        ],
      },
      {
        id: 'what-year-changes',
        question: 'What does the fishing year change in myLFR?',
        answer: [
          'Only the totals on **Home**. They count landings received in the fishing year shown, for the fishstocks that belong to that year. For example, with the October year chosen, your rock lobster landings aren\'t counted, because rock lobster uses the April year.',
          '**Monthly summaries** and **Export data** go by dates only, and include every fishstock.',
        ],
      },
      {
        id: 'switch-year',
        question: 'How do I switch to a different fishing year?',
        answer: [
          'On **Home**, use **Fishing year** beside the dates. You can also change it in **Settings**, under **Fishing year**; choose **Save fishing year** there. Both change the same setting.',
          'Switching only changes what Home shows. It never changes your landings.',
        ],
      },
      {
        id: 'year-rollover',
        question: 'What happens when a new fishing year starts?',
        answer: [
          'Nothing you need to do. On the first day of the new year, **Home** moves on to it by itself and its totals start again from zero. Last year\'s landings are all kept. You can still see them in **Monthly summaries**, **Export data** and **Search landings**.',
        ],
      },
    ],
  },
  {
    id: 'keeping-records-safe',
    title: 'Keeping records safe',
    summary: 'Backups, restoring, moving to a new computer, and privacy.',
    questions: [
      {
        id: 'where-records-kept',
        question: 'Where are my records kept? Are they sent anywhere?',
        answer: [
          'Your records are kept only on this computer. myLFR never sends them anywhere. The only time it uses the internet by itself is to check for updates.',
          'Because your records are only on this computer, backups are up to you.',
        ],
        seeAlso: ['what-is-backup'],
      },
      {
        id: 'what-is-backup',
        question: 'What is a backup, and why do I need one?',
        answer: [
          'A backup is a saved copy of all your records. If your computer is lost, stolen or stops working, a backup is the only way to get your records back. You also use a backup to move your records to a new computer.',
        ],
      },
      {
        id: 'choose-backup-folder',
        question: 'How do I choose where my backups are saved?',
        answer: [
          {
            steps: [
              'Go to **Settings**. Under **Data safety**, find **Database backups**.',
              'Choose **Choose backup folder**, or **Change backup folder** if you already have one.',
              'Pick a folder that isn\'t only on this computer: a USB drive, OneDrive, Google Drive, or a network drive.',
            ],
          },
          'When you choose a folder in **Settings**, myLFR makes a backup there straight away. You can also choose one on **Home** with **Choose backup folder now**, then choose **Back up now**.',
          'If the folder copies itself to the internet, such as OneDrive, give it time to finish before you turn the computer off.',
        ],
      },
      {
        id: 'when-backups-happen',
        question: 'When does myLFR make a backup?',
        answer: [
          'Automatically, after the first change you make each day. You can also make one at any time with **Back up now** on **Home**.',
          'myLFR keeps your 30 most recent backups, plus the most recent backup from each of the 12 most recent months in which a backup was made.',
          'To see your backups, go to **Settings** and choose **Open backup folder**. Backup files end in **.mylfr-backup**.',
        ],
      },
      {
        id: 'backup-warnings',
        question: 'What do the backup warnings mean?',
        answer: [
          {
            points: [
              '**Up to date**: all is well.',
              '**Backup due**: your last backup is more than two days old. Choose **Back up now** on **Home**.',
              '**Backup overdue**: your last backup is more than a week old. Choose **Back up now** on **Home** today.',
              '**No backup yet**: you have chosen a folder but no backup has been made. Choose **Back up now**.',
              '**Not set up**: you haven\'t chosen a backup folder yet.',
              '**Backup folder not found**: myLFR can\'t reach your backup folder, often because a USB drive is unplugged. Plug it back in, or choose another folder.',
            ],
          },
          'If your backups are on the same drive as myLFR, **Settings** warns you, because they would be lost along with the computer. If that folder is copied to Dropbox or another online service, your backups are already safe and you can choose **Hide this warning**.',
        ],
      },
      {
        id: 'restore',
        question: 'How do I get my records back from a backup?',
        answer: [
          'Restoring replaces all your current records and settings with the ones in the backup. Anything you changed after that backup was made is lost.',
          {
            steps: [
              'Go to **Settings**. Under **Data safety**, open **Advanced**.',
              'Under **Restore records**, choose **Choose backup to restore**.',
              'Pick the backup file. myLFR checks it before doing anything.',
              'Confirm, and myLFR replaces your records with the backup.',
            ],
          },
        ],
      },
      {
        id: 'new-computer',
        question: 'How do I move myLFR to a new computer?',
        answer: [
          {
            steps: [
              'On the old computer, choose **Back up now** on **Home**.',
              'Make sure the new computer can reach that backup: copy the **.mylfr-backup** file onto a USB drive, or wait for OneDrive or Google Drive to finish copying it.',
              'Install myLFR on the new computer.',
              'Read the notice and choose **I understand**.',
              'Instead of setting up a new business, choose **Restore from backup** and pick the backup file.',
              'Choose a backup folder for the new computer in **Settings**.',
            ],
          },
          'Don\'t copy myLFR\'s files across by hand. Always use a backup.',
        ],
        seeAlso: ['install'],
      },
      {
        id: 'export-excel',
        question: 'How do I get a copy of all my records in Excel?',
        answer: [
          'Go to **Settings** and choose **Export my data (Excel)**. It makes a workbook with your business details, permit holders, vessels, favourites, landings and landing history, which opens in Excel or Google Sheets.',
          'An Excel export isn\'t a backup. myLFR can\'t restore your records from it.',
        ],
      },
      {
        id: 'privacy',
        question: 'How do I keep my records private?',
        answer: [
          'Anyone who can sign in to your Windows account can open myLFR and see your records. Use a password on your Windows account, and turn on device encryption in Windows if your computer has it. Keep your backups somewhere only you can reach.',
        ],
      },
      {
        id: 'uninstall',
        question: 'How do I uninstall myLFR?',
        answer: [
          {
            steps: [
              'Choose **Back up now** on **Home** first.',
              'Close myLFR.',
              'In Windows, open **Settings**, then **Apps**, then **Installed apps**, find **myLFR Desktop** and choose **Uninstall**.',
            ],
          },
          'Your records stay on the computer unless you tick **Also permanently delete myLFR business records saved on this computer**. Only tick it if you are sure you have a backup.',
        ],
      },
    ],
  },
  {
    id: 'when-something-goes-wrong',
    title: 'When something goes wrong',
    summary: 'Updates, problems, and getting help.',
    questions: [
      {
        id: 'update',
        question: 'How do I update myLFR?',
        answer: [
          'Go to **Settings** and find **Application updates**. Under **Check for updates**, choose how myLFR finds updates:',
          {
            points: [
              '**Manual**: myLFR reminds you once a month to check. This is how it starts.',
              '**Automatic**: myLFR checks once a day by itself.',
            ],
          },
          'To check now, choose **Check for updates now**. If an update is found, choose **Review and install [version]** to see what\'s new, then choose **Install**. Leave **Back up my records before installing (recommended)** ticked. myLFR closes while the update installs.',
          'Nothing is ever installed without you choosing **Install**.',
        ],
      },
      {
        id: 'blue-button',
        question: 'What is the blue button at the bottom of the side menu?',
        answer: [
          'It means it\'s time to check for an update, or an update is ready. With **Manual** updates, it appears on the first Monday after the 15th. When it\'s time to check, choose it to open **Settings** at **Application updates**, then choose **Check for updates now**. If an update is ready, choose the button to review and install it. A reminder goes away once a check has worked.',
        ],
      },
      {
        id: 'update-check-failed',
        question: 'myLFR says it couldn\'t check for updates. What do I do?',
        answer: [
          'Check that the computer is connected to the internet, then try again later. Everything else in myLFR works without the internet. The reminder stays until a check works.',
        ],
      },
      {
        id: 'app-closed',
        question: 'myLFR closed by itself, or something isn\'t working. What should I do?',
        answer: [
          'Open myLFR again. Your saved records are safe. If it closed unexpectedly, myLFR notes what happened the next time it opens, ready for a problem report. Nothing is sent anywhere.',
          'If it keeps happening, or something doesn\'t work as it should, please report it.',
        ],
        seeAlso: ['report-problem'],
      },
      {
        id: 'report-problem',
        question: 'How do I report a problem?',
        answer: [
          {
            steps: [
              'Go to **Settings**. At the bottom of the page, open **Bug report** and choose **Copy problem report**.',
              'Choose **Report on GitHub**. Your web browser opens the report form. You need a free GitHub account.',
              'Paste the problem report into the form, and describe what you were doing when it went wrong.',
            ],
          },
          'The problem report has the app version and details of recent errors. It never includes your records or where your files are kept.',
          'Reports on GitHub can be seen by anyone, so don\'t add business names, permit holders, vessels or landing details. Never send anyone your backup files.',
        ],
      },
      {
        id: 'support',
        question: 'Is there someone I can phone or email?',
        answer: [
          'No. myLFR is free software with no support line or email address. The only way to report a problem is on GitHub, through **Settings → Bug report**. Replies and fixes aren\'t guaranteed.',
        ],
      },
      {
        id: 'resources',
        question: 'Where can I find FishServe and the fishing rules?',
        answer: [
          'The **Resources** page has links to FishServe\'s fishstock, permit and vessel searches, its conversion factor calculator, and the reporting and recordkeeping regulations. They open in your web browser and need the internet.',
        ],
      },
    ],
  },
];

function blockText(block: FaqBlock): string {
  if (typeof block === 'string') return block;
  return ('steps' in block ? block.steps : block.points).join(' ');
}

/** A question's words without bold markers, for searching. */
export function faqSearchText(question: FaqQuestion): string {
  return [question.question, ...question.answer.map(blockText)].join(' ').replace(/\*\*/g, '').toLocaleLowerCase();
}

/** The groups and questions containing every word of the search. Groups with no match are left out. */
export function searchFaq(groups: FaqGroup[], search: string): FaqGroup[] {
  const words = search.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return groups;
  return groups
    .map((group) => ({ ...group, questions: group.questions.filter((question) => {
      const text = faqSearchText(question);
      return words.every((word) => text.includes(word));
    }) }))
    .filter((group) => group.questions.length);
}

export function findFaqQuestion(id: string): FaqQuestion | undefined {
  return FAQ_GROUPS.flatMap((group) => group.questions).find((question) => question.id === id);
}
