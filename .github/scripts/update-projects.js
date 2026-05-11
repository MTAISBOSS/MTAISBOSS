const { Octokit } = require('@octokit/rest');
const fs = require('fs-extra');
const axios = require('axios');

// Configuration
const CONFIG = {
  // GitHub settings
  REQUIRED_TOPIC: 'resume',
  
  // Itch.io settings
  ITCH_USERNAME: 'mtaisboss',
  ITCH_API_URL: `https://itch.io/api/1/${process.env.ITCH_API_KEY || 'YOUR_ITCH_API_KEY'}/my-games`,
  
  // Language to tag mapping
  LANGUAGE_TAGS: {
    'c#': '',
    'c++': '',
    'python': 'blue',
    'javascript': 'yellow',
    'typescript': 'yellow',
    'shaderlab': 'purple',
    'hlsl': 'purple',
    'glsl': 'purple'
  }
};

class PortfolioUpdater {
  constructor() {
    this.octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
    this.username = process.env.GITHUB_USERNAME;
    this.existingProjects = new Set();
    this.existingItchUrls = new Set();
    this.allProjects = [];
  }

  async fetchGitHubProjects() {
    console.log('🔍 Fetching GitHub repositories with "resume" topic...');
    
    const allRepos = await this.octokit.paginate(
      this.octokit.rest.repos.listForUser, {
        username: this.username,
        type: 'public',
        sort: 'updated',
        direction: 'desc',
        per_page: 100
      }
    );

    return allRepos.filter(repo => 
      !repo.fork && !repo.archived && 
      repo.topics?.includes(CONFIG.REQUIRED_TOPIC)
    );
  }

  async fetchItchProjects() {
    console.log('🎮 Fetching itch.io projects...');
    
    try {
      // If you have an API key, use the authenticated endpoint
      if (process.env.ITCH_API_KEY) {
        console.log('  Using API key for authenticated access...');
        const response = await axios.get(CONFIG.ITCH_API_URL);
        const games = response.data.games || [];
        console.log(`  📦 Found ${games.length} itch.io projects via API`);
        return games.map(game => ({
          title: game.title,
          url: game.url,
          short_text: game.short_text || game.description || '',
          type: this.determineGameType(game.title, game.short_text || ''),
          screenshots: game.screenshots || [],
          genres: game.genre ? [game.genre] : []
        }));
      }
      
      // Fallback: Scrape the public page
      console.log('⚠️  No ITCH_API_KEY found, using public page scraping...');
      return await this.scrapeItchPage();
      
    } catch (error) {
      console.error('Error fetching itch.io projects:', error.message);
      return [];
    }
  }

  async scrapeItchPage() {
    try {
      const response = await axios.get(`https://${CONFIG.ITCH_USERNAME}.itch.io`);
      const html = response.data;
      
      console.log('  Parsing itch.io page...');
      
      // Method 1: Try to find game links with titles
      const games = [];
      
      // Look for game cells/thumbnails
      const gameCellRegex = /<div class="game_cell"[^>]*>[\s\S]*?<a href="(https:\/\/[^"]*)"[^>]*>[\s\S]*?<div class="game_title"[^>]*>([^<]+)<\/div>[\s\S]*?<div class="game_text"[^>]*>([^<]*)<\/div>[\s\S]*?<\/div>/g;
      
      let match;
      while ((match = gameCellRegex.exec(html)) !== null) {
        const url = match[1];
        const title = match[2].trim();
        const description = match[3].trim() || `${title} - A game project`;
        
        if (this.isValidGameUrl(url)) {
          games.push({
            title: title,
            url: url,
            short_text: description,
            type: this.determineGameType(title, description),
            screenshots: [],
            genres: []
          });
        }
      }
      
      // Method 2: If no games found, try alternative parsing
      if (games.length === 0) {
        console.log('  Trying alternative parsing method...');
        const linkRegex = /<a href="(https:\/\/[^"]*\.itch\.io\/([^"\/]+))"[^>]*class="[^"]*game_link[^"]*"[^>]*>/g;
        
        while ((match = linkRegex.exec(html)) !== null) {
          const url = match[1];
          const slug = match[2];
          
          if (this.isValidGameUrl(url) && !games.find(g => g.url === url)) {
            const title = slug.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
            games.push({
              title: title,
              url: url,
              short_text: `${title} - A game project on itch.io`,
              type: 'Game Project',
              screenshots: [],
              genres: []
            });
          }
        }
      }
      
      // Method 3: Last resort - find all itch.io game URLs
      if (games.length === 0) {
        console.log('  Trying last resort parsing...');
        const allLinks = html.match(/https:\/\/[^"'\s]*\.itch\.io\/[^"'\s]+/g) || [];
        const uniqueUrls = [...new Set(allLinks)];
        
        for (const url of uniqueUrls) {
          if (this.isValidGameUrl(url) && !games.find(g => g.url === url)) {
            const urlParts = url.split('/');
            const slug = urlParts[urlParts.length - 1];
            const title = slug.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
            
            games.push({
              title: title,
              url: url,
              short_text: `${title} - A game project on itch.io`,
              type: 'Game Project',
              screenshots: [],
              genres: []
            });
          }
        }
      }
      
      console.log(`  📦 Found ${games.length} itch.io projects`);
      return games;
      
    } catch (error) {
      console.error('Error scraping itch.io:', error.message);
      return [];
    }
  }

  isValidGameUrl(url) {
    // Filter out non-game URLs
    const excludePatterns = [
      '/community/',
      '/profile/',
      '/games/',
      '/tools/',
      '/assets/',
      '/devlog/',
      '/jam/',
      '/search',
      '/register',
      '/login',
      '/dashboard',
      '/settings',
      '/api/',
      '/embed/',
      '/rate/',
      '/buy/',
      '/download/'
    ];
    
    // Must be an itch.io URL
    if (!url.includes('itch.io')) return false;
    
    // Must not be the main profile page
    if (url === `https://${CONFIG.ITCH_USERNAME}.itch.io/` || 
        url === `https://${CONFIG.ITCH_USERNAME}.itch.io`) {
      return false;
    }
    
    // Check against exclude patterns
    for (const pattern of excludePatterns) {
      if (url.includes(pattern)) return false;
    }
    
    return true;
  }

  async getItchGameDetails(gameData) {
    // If we already have screenshots and genres from API, use those
    if (gameData.screenshots.length > 0 && gameData.genres.length > 0) {
      return gameData;
    }
    
    try {
      console.log(`    Fetching details for: ${gameData.title}`);
      const response = await axios.get(gameData.url);
      const html = response.data;
      
      // Extract screenshots
      const screenshots = [];
      const imgRegex = /<img[^>]+src="([^"]+)"[^>]*>/g;
      let match;
      while ((match = imgRegex.exec(html)) !== null) {
        const src = match[1];
        if ((src.includes('itch.zone') || src.includes('itch.io')) && 
            !src.includes('avatar') && 
            !src.includes('icon') &&
            !src.includes('logo') &&
            !src.includes('banner')) {
          screenshots.push(src);
        }
      }
      
      // Extract full description
      const descMatch = html.match(/<div class="formatted_description">([\s\S]*?)<\/div>/);
      const fullDescription = descMatch ? descMatch[1].replace(/<[^>]+>/g, '').trim() : gameData.short_text;
      
      // Extract genres/tags
      const genres = [];
      const genreRegex = /<a href="\/genre\/[^"]*"[^>]*>([^<]+)<\/a>/g;
      while ((match = genreRegex.exec(html)) !== null) {
        if (!genres.includes(match[1])) {
          genres.push(match[1]);
        }
      }
      
      return {
        ...gameData,
        screenshots: screenshots.slice(0, 3),
        fullDescription: fullDescription,
        genres: genres.slice(0, 3)
      };
      
    } catch (error) {
      console.error(`    Error fetching details for ${gameData.title}:`, error.message);
      return {
        ...gameData,
        screenshots: gameData.screenshots || [],
        fullDescription: gameData.short_text || '',
        genres: gameData.genres || []
      };
    }
  }

  determineGameType(title, description) {
    const text = (title + ' ' + description).toLowerCase();
    if (text.includes('survival')) return 'Survival Game';
    if (text.includes('puzzle')) return 'Puzzle Game';
    if (text.includes('shooter') || text.includes('fps')) return 'Shooter Game';
    if (text.includes('platformer')) return 'Platformer Game';
    if (text.includes('action')) return 'Action Game';
    if (text.includes('endless runner') || text.includes('runner')) return 'Endless Runner Game';
    if (text.includes('avoid')) return 'Avoidance Game';
    if (text.includes('horror')) return 'Horror Game';
    if (text.includes('rpg') || text.includes('role-playing')) return 'RPG Game';
    return 'Game Project';
  }

  processGitHubProject(repo) {
    const topics = repo.topics.filter(t => t !== CONFIG.REQUIRED_TOPIC) || [];
    
    // Generate tags
    const tags = [];
    if (repo.language) {
      const langLower = repo.language.toLowerCase();
      tags.push({
        name: repo.language,
        class: CONFIG.LANGUAGE_TAGS[langLower] || ''
      });
    }
    
    topics.slice(0, 3).forEach(topic => {
      const formattedName = topic.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
      if (!tags.find(t => t.name.toLowerCase() === formattedName.toLowerCase())) {
        tags.push({ name: formattedName, class: '' });
      }
    });

    return {
      name: repo.name.replace(/[-_]/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
      description: repo.description || 'A project built with passion.',
      type: 'GitHub Project',
      url: repo.homepage || `https://github.com/${this.username}/${repo.name}`,
      tags: tags.slice(0, 4),
      screenshots: [],
      source: 'github',
      repoName: repo.name
    };
  }

  generateProjectCard(project) {
    let screenshotsHTML = '';
    
    if (project.screenshots && project.screenshots.length > 0) {
      // Use actual screenshots (from itch.io API or scraping)
      const screenshotUrls = project.screenshots.slice(0, 3);
      screenshotsHTML = `
            <div
                class="project-slider"
                data-alt="${project.name} screenshot"
                data-images="
                    ${screenshotUrls.join(',\n                    ')}
                "
            ></div>`;
    } else if (project.source === 'github') {
      // Fallback to local assets for GitHub projects
      const assetName = project.repoName || project.name.toLowerCase().replace(/\s+/g, '-');
      screenshotsHTML = `
            <div
                class="project-slider"
                data-alt="${project.name} screenshot"
                data-images="
                    assets/${assetName}.png,
                    assets/${assetName}1.png,
                    assets/${assetName}2.png
                "
            ></div>`;
    } else {
      // Fallback for itch.io projects without screenshots
      const assetName = project.name.toLowerCase().replace(/\s+/g, '-');
      screenshotsHTML = `
            <div
                class="project-slider"
                data-alt="${project.name} screenshot"
                data-images="
                    assets/${assetName}.png,
                    assets/${assetName}1.png,
                    assets/${assetName}2.png
                "
            ></div>`;
    }

    // Generate tags HTML
    let tagsHTML = '';
    if (project.tags && project.tags.length > 0) {
      tagsHTML = project.tags
        .map(tag => `<span class="tag${tag.class ? ' ' + tag.class : ''}">${tag.name}</span>`)
        .join('\n                ');
    } else {
      // Default tag if no others
      tagsHTML = '<span class="tag">Game</span>';
    }

    // Determine link label
    let linkLabel = 'Link →';
    if (project.url.includes('itch.io')) linkLabel = 'Play →';
    else if (project.source === 'github') linkLabel = 'GitHub →';

    return `
        <article class="card">${screenshotsHTML}
            <h3>${project.name}</h3>
            <div class="meta">${project.type}</div>
            <p>
                ${project.description}
            </p>
            <div>
                ${tagsHTML}
            </div>
            <div class="link-row">
                <a href="${project.url}" target="_blank" rel="noopener">${linkLabel}</a>
            </div>
        </article>`;
  }

  parseExistingProjects(html) {
    // Extract existing project names from <h3> tags
    const nameRegex = /<h3>(.*?)<\/h3>/g;
    let match;
    while ((match = nameRegex.exec(html)) !== null) {
      const name = match[1].trim();
      // Skip the "Additional Indie" card title
      if (name !== 'Additional Indie & Game Jam Projects') {
        this.existingProjects.add(name);
      }
    }
    
    // Also track existing itch.io URLs to avoid duplicates
    const itchUrlRegex = /href="(https:\/\/[^"]*itch\.io\/[^"]*)"/g;
    while ((match = itchUrlRegex.exec(html)) !== null) {
      const url = match[1];
      // Only add game-specific URLs, not the main profile
      if (url !== `https://${CONFIG.ITCH_USERNAME}.itch.io/` && 
          url !== `https://${CONFIG.ITCH_USERNAME}.itch.io`) {
        this.existingItchUrls.add(url);
      }
    }
    
    console.log(`Found ${this.existingProjects.size} existing projects and ${this.existingItchUrls.size} itch.io URLs`);
  }

  async updatePortfolio() {
    const filePath = 'docs/partials/selected-projects.html';
    
    try {
      console.log('📂 Reading existing portfolio file...');
      let html = await fs.readFile(filePath, 'utf8');
      
      // Parse existing projects
      this.parseExistingProjects(html);

      // Fetch from both sources
      console.log('\n🌐 Fetching projects from GitHub and itch.io...');
      const [githubRepos, itchGames] = await Promise.all([
        this.fetchGitHubProjects(),
        this.fetchItchProjects()
      ]);

      // Process GitHub projects
      const githubProjects = githubRepos.map(repo => this.processGitHubProject(repo));
      console.log(`📁 Processed ${githubProjects.length} GitHub projects`);
      
      // Filter out existing itch.io games by URL
      const newItchGames = itchGames.filter(game => !this.existingItchUrls.has(game.url));
      console.log(`🎮 Found ${newItchGames.length} new itch.io games (out of ${itchGames.length} total)`);
      
      // Process itch.io projects with details
      const itchProjects = [];
      for (const game of newItchGames) {
        console.log(`  Processing: ${game.title}`);
        const detailedGame = await this.getItchGameDetails(game);
        const project = {
          name: game.title,
          description: detailedGame.fullDescription || game.short_text || 'A creative game project on itch.io',
          type: game.type || 'Game Project',
          url: game.url,
          tags: (detailedGame.genres || []).map(g => ({ name: g, class: '' })),
          screenshots: detailedGame.screenshots || [],
          source: 'itch.io'
        };
        itchProjects.push(project);
      }

      // Combine all new projects
      const allNewProjects = [...githubProjects, ...itchProjects];
      
      // Filter out projects that already exist by name
      const newProjects = allNewProjects.filter(project => 
        !this.existingProjects.has(project.name)
      );

      if (newProjects.length === 0) {
        console.log('\n✅ All projects are already in the portfolio. No updates needed.');
        return;
      }

      console.log(`\n✨ Adding ${newProjects.length} new projects:`);
      newProjects.forEach(p => console.log(`  ${p.source === 'itch.io' ? '🎮' : '📁'} ${p.name} - ${p.url}`));

      // Generate cards for new projects
      const newCards = newProjects
        .map(project => this.generateProjectCard(project))
        .join('\n');

      // Find the insertion point - BEFORE the "Additional Indie" card
      // This ensures new cards stay inside the grid div
      const additionalCardMarker = '<div class="card" style="margin-top:15px;">';
      
      if (html.includes(additionalCardMarker)) {
        // Insert new cards directly before the "Additional Indie" card
        // Both will be inside the grid div
        html = html.replace(additionalCardMarker, `${newCards}\n        ${additionalCardMarker}`);
        console.log('✅ Inserted new cards inside grid, before "Additional Indie" section');
      } else {
        // If no additional card exists, insert before closing grid tag
        const gridEndMarker = '    </div>\n\n</section>';
        if (html.includes(gridEndMarker)) {
          html = html.replace(gridEndMarker, `${newCards}\n${gridEndMarker}`);
          console.log('✅ Inserted new cards at end of grid');
        } else {
          // Last resort: insert before closing section tag
          html = html.replace('</section>', `${newCards}\n</section>`);
          console.log('⚠️  Inserted new cards before section close (verify grid structure)');
        }
      }

      // Verify and fix grid structure
      html = this.ensureProperGridStructure(html);

      // Write updated file
      await fs.writeFile(filePath, html, 'utf8');
      console.log('\n✅ Portfolio updated successfully!');
      console.log(`   📄 File: ${filePath}`);
      console.log(`   📊 Total projects added: ${newProjects.length}`);
      
    } catch (error) {
      console.error('\n❌ Error updating portfolio:', error);
      throw error;
    }
  }

  ensureProperGridStructure(html) {
    // Find all positions of grid div and article cards
    const gridOpen = '<div class="grid">';
    const gridClose = '    </div>';
    const sectionClose = '</section>';
    
    // Find the grid div
    const gridStartIndex = html.indexOf(gridOpen);
    if (gridStartIndex === -1) {
      console.warn('⚠️  Could not find grid div opening tag');
      return html;
    }
    
    // Find the section closing tag after the grid
    const sectionCloseIndex = html.indexOf(sectionClose, gridStartIndex);
    if (sectionCloseIndex === -1) {
      console.warn('⚠️  Could not find section closing tag');
      return html;
    }
    
    // Get content between grid start and section close
    const gridSection = html.substring(gridStartIndex, sectionCloseIndex);
    
    // Find the last occurrence of grid close in this section
    const lastGridCloseIndex = gridSection.lastIndexOf(gridClose);
    
    if (lastGridCloseIndex !== -1) {
      const absoluteGridCloseIndex = gridStartIndex + lastGridCloseIndex;
      
      // Check if there's content between grid close and section close
      const contentAfterGridClose = html.substring(absoluteGridCloseIndex + gridClose.length, sectionCloseIndex).trim();
      
      if (contentAfterGridClose && contentAfterGridClose.includes('<article class="card">')) {
        console.log('🔧 Fixing grid structure - moving articles inside grid...');
        
        // Remove the premature grid close
        const beforeGridClose = html.substring(0, absoluteGridCloseIndex);
        const afterGridClose = html.substring(absoluteGridCloseIndex + gridClose.length);
        
        // Add grid close right before section close
        const sectionCloseIndex2 = afterGridClose.indexOf(sectionClose);
        const beforeSectionClose = afterGridClose.substring(0, sectionCloseIndex2);
        const afterSectionClose = afterGridClose.substring(sectionCloseIndex2);
        
        html = beforeGridClose + beforeSectionClose + gridClose + '\n' + afterSectionClose;
        console.log('✅ Grid structure fixed');
      }
    }
    
    return html;
  }
}

// Execute the script
console.log('🚀 Portfolio Updater Starting...\n');
console.log('='.repeat(50));

const updater = new PortfolioUpdater();
updater.updatePortfolio()
  .then(() => {
    console.log('\n' + '='.repeat(50));
    console.log('✨ Script completed successfully!');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n' + '='.repeat(50));
    console.error('💥 Script failed:', error.message);
    process.exit(1);
  });