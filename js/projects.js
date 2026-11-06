/* ==========================================================================
   SITE CONTENT — this is the only file you need to edit.
   ==========================================================================

   ADDING A NEW PROJECT
   1. Put its images in /images/<slug>/  (e.g. images/my-game/cover.jpg)
   2. Copy one of the project blocks below, paste it where you want it in the
      list (the order here is the order on the page), and fill it in.
      Games go in window.PROJECTS, and software goes in window.SOFTWARE.
   3. Save, commit, push. Done.

   Cover images look best at about 1.28 : 1 (e.g. 1280 x 1000 px).
   Leave `cover` / `hoverCover` empty ("") and a colored placeholder is shown.
   Every project needs a unique slug, and "software" is taken by the Software page.

   OPTIONAL CARD LINES — leave any of these out and that line isn't shown:
     summary, teamSize, roles, dates

   PROJECT PAGE BLOCKS — stacked top to bottom on the project's page:
     { type: "heading", text: "Section title" }
     { type: "text",    text: "A paragraph. Blank lines start new paragraphs." }
     { type: "image",   src: "images/slug/shot.png", caption: "optional" }
     { type: "gallery", images: ["images/slug/a.png", "images/slug/b.png"] }
     { type: "video",   youtube: "dQw4w9WgXcQ" }      // just the YouTube video ID
     { type: "video",   src: "images/slug/trailer.mp4" } // or a self-hosted file
     { type: "embed",   src: "https://itch.io/embed-upload/...", height: 600 }
   ========================================================================== */

window.SITE = {
  name: "William Schell",
  aboutTitle: "About Me",
  about:
    "Hello! My name is William Schell. I have been coding and making video games " +
    "since I was just 12 years old! Ten years later, and I am much more vetted " +
    "in the profession now. I am slated to graduate from Virginia Tech in May of " +
     "2027 with a Bachelors in Computer Science. Below are some of the projects " +
     "I have worked on during my time here!",
  email: "williamschelldev@gmail.com",
  cv: "",            // link to your CV / resume (Google Drive, PDF in /images, etc.) — leave "" to hide
  socials: [
    // types with icons: linkedin, youtube, github, itch, email. Anything else shows a generic link icon.
    { type: "linkedin", url: "https://www.linkedin.com/in/william-schell/" },
    { type: "itch",     url: "https://duckzi8.itch.io/" },
    { type: "youtube",  url: "https://www.youtube.com/@your-handle" },
    { type: "email",    url: "mailto:williamschelldev@gmail.com" }
  ]
};

window.PROJECTS = [
  {
    slug: "Bullet Ant",          // used in the URL: williamschell.dev/#example-game-one
    title: "Bullet Ant",
    teamSize: "Solo",
    roles: "Game Design, Programming, 2D Art, Sound, Music",
    dates: "5 Day Game Jam, July 2026",
    cover: "images/bulletantcover.png",                          // e.g. "images/example-game-one/cover.png"
    hoverCover: "",                     // image shown when hovering the cover (optional)
    engine: "Godot",                    // optional
    links: [
      { label: "Play on itch.io", url: "https://duckzi8.itch.io/bullet-ant" }
    ],
    blocks: [
      { type: "text", text: "A short pitch for the game: what it is, what the player does, and what makes it interesting.\n\nWhat you personally built, the hardest design problem you solved, and what you learned." },
      { type: "heading", text: "Design Highlights" },
      { type: "text", text: "Replace this with screenshots, GIFs, a trailer, design docs, whatever shows the work best." }
    ]
  },
  {
    slug: "Cavity",
    title: "Cavity",
    teamSize: "Team of 2",
    roles: "Game Design, Programming, 2D Art, 3D Art, Sound, Music, Writing",
    dates: "14 Day Game Jam, July 2026",
    cover: "images/caivtycover.png",
    hoverCover: "",
    links: [{ label: "Play on itch.io", url: "https://duckzi8.itch.io/cavity" }],
    blocks: [
      { type: "text", text: "Project description goes here." }
    ]
  },
  {
    slug: "In Sheeps Clothing",
    title: "In Sheeps Clothing",
    teamSize: "Team of 2",
    roles: "Game Design, Writing, Programming, 3D Map Art",
    dates: "August 2026",
    cover: "images/insheepsclothingcover.png",
    hoverCover: "",
    links: [{ label: "Play on itch.io", url: "https://duckzi8.itch.io/in-sheeps-clothing" }],
    blocks: [
      { type: "text", text: "Project description goes here." }
    ]
  },
  {
    slug: "Autumn Painting",
    title: "Autumn Painting",
    teamSize: "Team of 2",
    roles: "Team lead, Programming, Map Design, Game Design",
    dates: "48-hour Game Jam, 2026",
    cover: "images/autumnpaintingcover.png",
    hoverCover: "",
    links: [{ label: "Play on itch.io", url: "https://duckzi8.itch.io/autumn-painting" }],
    blocks: [
      { type: "text", text: "Project description goes here." }
    ]
  }
];

window.SOFTWARE = [
  {
    slug: "Splotchle",
    title: "Splotchle",
    summary: "A daily drawing challenge: turn a weird blob into a character.",
    cover: "images/splotchlecover.png",
    links: [{ label: "Open Splotchle", url: "splotchle/" }],
    blocks: [
      { type: "text", text: "Everyone gets the same weird blob each day. Draw whatever you see in it, post it to the public gallery, and like what other people came up with. Free play offers endless new blobs, and those drawings can be shared in their own Unlimiteds gallery.\n\nEach blob is generated in the browser from a seed, using metaballs, noise and marching squares, so the same seed always gives the same shape. The app is plain JavaScript with no build step, and it uses Supabase for the public galleries." }
    ]
  },
  {
    slug: "Worldbuilder",
    title: "Worldbuilder",
    summary: "A 3D map and codex for building a fictional universe.",
    cover: "images/worldbuildercover.png",
    links: [{ label: "Open Worldbuilder", url: "worldbuilder/" }],
    blocks: [
      { type: "text", text: "Lay out a universe on a 3D map, with star systems, free worlds, binary pairs and stations that you can drag into place. Alongside the map, a codex keeps track of its peoples, factions, characters, religions, languages, technology, animals and plants.\n\nIt has a built-in search, and a universe can be exported and imported." }
    ]
  },
  {
    slug: "Spinner",
    title: "Spinner",
    summary: "Chain spinning wheels together to generate anything.",
    cover: "images/spinnercover.png",
    links: [{ label: "Open Spinner", url: "spinner/" }],
    blocks: [
      { type: "text", text: "Spinner links decision wheels into chains. Each wheel can lead to a default next wheel, and any single entry can branch somewhere else, so one result can change what gets asked next. A chain map shows how the wheels connect.\n\nIt starts with a sample chain that generates a character for Deadlock, and you can build your own wheels and sort them into folders." }
    ]
  },
  {
    slug: "Novle",
    title: "Novle",
    summary: "A daily short story challenge with one prompt for everyone.",
    cover: "images/novlecover.png",
    links: [{ label: "Open Novle", url: "novle/" }],
    blocks: [
      { type: "text", text: "Everyone gets the same prompt, genre and word limit each day. Write a story, post it to the public gallery, and like the ones other people wrote. Practice mode is there for writing outside the daily challenge.\n\nWriting, saving and drafts all work without a connection, and Supabase powers the public gallery." }
    ]
  }
];
