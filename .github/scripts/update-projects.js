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
        const response = await axios.get(CONFIG.ITCH_API_URL);
        return response.data.games || [];
      }
      
      // Fallback: Scrape the public page (less reliable but works without API key)
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
      
      // Parse game data from HTML
      const games = [];
      const gameRegex = /<a href="(https:\/\/[^"]*\.itch\.io\/[^"]*)"[^>]*>[\s\S]*?<div class="game_title"[^>]*>([^<]+)<\/div>[\s\S]*?<div class="game_text"[^>]*>([^<]*)<\/div>/g;
      
      let match;
      while ((match = gameRegex.exec(html)) !== null) {
        const url = match[1];
        const title = match[2].trim();
        const description = match[3].trim() || `${title} - A game project`;
        
        // Only add if it's a game page (not community/profile links)
        if (url.includes('/itch.io/') && url !== `https://${CONFIG.ITCH_USERNAME}.itch.io/`) {
          games.push({
            title: title,
            url: url,
            short_text: description,
            type: this.determineGameType(title, description)
          });
        }
      }
      
      console.log(`  📦 Found ${games.length} itch.io projects`);
      return games;
      
    } catch (error) {
      console.error('Error scraping itch.io:', error.message);
      return [];
    }
  }

  async getItchGameDetails(gameUrl) {
    try {
      const response = await axios.get(gameUrl);
      const html = response.data;
      
      // Extract screenshots
      const screenshots = [];
      const imgRegex = /<img[^>]+src="([^"]+)"[^>]*>/g;
      let match;
      while ((match = imgRegex.exec(html)) !== null) {
        if (match[1].includes('itch.zone') || match[1].includes('itch.io')) {
          screenshots.push(match[1]);
        }
      }
      
      // Extract full description
      const descMatch = html.match(/<div class="formatted_description">([\s\S]*?)<\/div>/);
      const fullDescription = descMatch ? descMatch[1].replace(/<[^>]+>/g, '').trim() : '';
      
      // Extract genres/tags
      const genres = [];
      const genreRegex = /<a href="\/genre\/[^"]*">([^<]+)<\/a>/g;
      while ((match = genreRegex.exec(html)) !== null) {
        genres.push(match[1]);
      }
      
      return {
        screenshots: screenshots.slice(0, 3),
        fullDescription: fullDescription,
        genres: genres.slice(0, 3)
      };
      
    } catch (error) {
      console.error(`Error fetching details for ${gameUrl}:`, error.message);
      return {
        screenshots: [],
        fullDescription: '',
        genres: []
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
    if (text.includes('endless runner')) return 'Endless Runner Game';
    return 'Game Project';
  }

  async processItchProject(game) {
    console.log(`  🎮 Processing: ${game.title}`);
    
    // Get additional details
    const details = await this.getItchGameDetails(game.url);
    
    return {
      name: game.title,
      description: details.fullDescription || game.short_text || 'A creative game project',
      type: game.type || 'Game Project',
      url: game.url,
      tags: details.genres.map(g => ({ name: g, class: '' })),
      screenshots: details.screenshots,
      source: 'itch.io'
    };
  }

  processGitHubProject(repo) {
    const topics = repo.topics.filter(t => t !== CONFIG.REQUIRED_TOPIC) || [];
    
    // Generate tags
    const tags = [];
    if (repo.language) {
      tags.push({
        name: repo.language,
        class: CONFIG.LANGUAGE_TAGS[repo.language.toLowerCase()] || ''
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
    // Generate screenshots HTML
    let screenshotsHTML = '';
    if (project.screenshots && project.screenshots.length > 0) {
      screenshotsHTML = `
            <div
                class="project-slider"
                data-alt="${project.name} screenshot"
                data-images="
                    ${project.screenshots.slice(0, 3).join(',\n                    ')}
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
    }

    // Generate tags HTML
    const tagsHTML = project.tags
      .map(tag => `<span class="tag${tag.class ? ' ' + tag.class : ''}">${tag.name}</span>`)
      .join('\n                ');

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
    const nameRegex = /<h3>(.*?)<\/h3>/g;
    let match;
    while ((match = nameRegex.exec(html)) !== null) {
      this.existingProjects.add(match[1].trim());
    }
  }

  async updatePortfolio() {
    const filePath = 'docs/partials/selected-projects.html';
    
    try {
      let html = await fs.readFile(filePath, 'utf8');
      this.parseExistingProjects(html);

      // Fetch from both sources
      const [githubRepos, itchGames] = await Promise.all([
        this.fetchGitHubProjects(),
        this.fetchItchProjects()
      ]);

      // Process GitHub projects
      const githubProjects = githubRepos.map(repo => this.processGitHubProject(repo));
      
      // Process itch.io projects (with details)
      const itchProjects = await Promise.all(
        itchGames.map(game => this.processItchProject(game))
      );

      // Combine all projects
      const allProjects = [...githubProjects, ...itchProjects];
      
      // Find new projects
      const newProjects = allProjects.filter(project => 
        !this.existingProjects.has(project.name)
      );

      if (newProjects.length === 0) {
        console.log('✅ All projects are already in the portfolio');
        return;
      }

      console.log(`\n✨ Adding ${newProjects.length} new projects:`);
      newProjects.forEach(p => console.log(`  ${p.source === 'itch.io' ? '🎮' : '📁'} ${p.name}`));

      // Generate cards
      const newCards = newProjects
        .map(project => this.generateProjectCard(project))
        .join('\n');

      // Insert into HTML
      const additionalCardMarker = '<div class="card" style="margin-top:15px;">';
      if (html.includes(additionalCardMarker)) {
        html = html.replace(additionalCardMarker, `${newCards}\n${additionalCardMarker}`);
      }

      await fs.writeFile(filePath, html, 'utf8');
      console.log('✅ Portfolio updated successfully!');
      
    } catch (error) {
      console.error('❌ Error updating portfolio:', error);
      throw error;
    }
  }
}

// Execute
const updater = new PortfolioUpdater();
updater.updatePortfolio().catch(error => {
  console.error('Script failed:', error);
  process.exit(1);
});