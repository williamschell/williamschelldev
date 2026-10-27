/* ==========================================================================
   SITE CONTENT — this is the only file you need to edit.
   ==========================================================================

   ADDING A NEW PROJECT
   1. Put its images in /images/<slug>/  (e.g. images/my-game/cover.jpg)
   2. Copy one of the project blocks below, paste it where you want it in the
      list (the order here is the order on the homepage), and fill it in.
   3. Save, commit, push. Done.

   Cover images look best at about 1.28 : 1 (e.g. 1280 x 1000 px).
   Leave `cover` / `hoverCover` empty ("") and a colored placeholder is shown.

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
     "2026 with a Bachelors in Computer Science. Below are some of the projects " +
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
    dates: "5 Day Game Jam, July, 2026",
    cover: "",                          // e.g. "images/example-game-one/cover.png"
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
    title: "Example Game Two",
    teamSize: "Team of 4",
    roles: "Lead Design, Systems Programming",
    dates: "January 2024 - May 2024",
    cover: "",
    hoverCover: "",
    links: [],
    blocks: [
      { type: "text", text: "Project description goes here." }
    ]
  },
  {
    slug: "In Sheeps Clothing",
    title: "Example Game Three",
    teamSize: "Solo",
    roles: "Game Design, Writing",
    dates: "September 2023",
    cover: "",
    hoverCover: "",
    links: [],
    blocks: [
      { type: "text", text: "Project description goes here." }
    ]
  },
  {
    slug: "Mira",
    title: "Example Game Four",
    teamSize: "Game Jam Team of 3",
    roles: "Programming, Level Design",
    dates: "48-hour Game Jam, 2023",
    cover: "",
    hoverCover: "",
    links: [],
    blocks: [
      { type: "text", text: "Project description goes here." }
    ]
  }
];
