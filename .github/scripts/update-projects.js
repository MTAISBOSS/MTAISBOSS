const { Octokit } = require('@octokit/rest');
const fs = require('fs-extra');
const path = require('path');

// Configuration
const CONFIG = {
  // Only include repos with this topic
  REQUIRED_TOPIC: 'resume',
  
  // Language to tag mapping (customize based on your tech stack)
  LANGUAGE_TAGS: {
    'c#': '',
    'c++': '',
    'python': 'blue',
    'javascript': 'yellow',
    'typescript': 'yellow',
    'shaderlab': 'purple',
    'hlsl': 'purple',
    'glsl': 'purple'
  },
  
  // Project type indicators based on topics
  PROJECT_TYPES: {
    'unity': ['unity', 'game', 'unity3d', 'hdrp', 'urp'],
    'unreal': ['unreal', 'ue4', 'ue5'],
    'mobile': ['mobile', 'android', 'ios'],
    'web': ['web', 'website', 'frontend', 'backend'],
    'ai': ['ai', 'ml', 'machine-learning', 'neural'],
    'graphics': ['graphics', 'shader', 'rendering', 'ray-tracing']
  }
};

class ProjectUpdater {
  constructor() {
    this.octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
    this.username = process.env.GITHUB_USERNAME;
    this.existingProjects = new Set();
    this.resumeProjects = [];
  }

  async fetchResumeRepos() {
    try {
      console.log(`Fetching public repositories with '${CONFIG.REQUIRED_TOPIC}' topic...`);
      
      // Fetch all public repos
      const allRepos = await this.octokit.paginate(
        this.octokit.rest.repos.listForUser,
        {
          username: this.username,
          type: 'public',
          sort: 'updated',
          direction: 'desc',
          per_page: 100
        }
      );

      // Filter repos that:
      // 1. Are not forks
      // 2. Are not archived
      // 3. Have the 'resume' topic
      const resumeRepos = allRepos.filter(repo => 
        !repo.fork && 
        !repo.archived &&
        repo.topics && 
        repo.topics.includes(CONFIG.REQUIRED_TOPIC)
      );

      console.log(`Found ${resumeRepos.length} repositories with '${CONFIG.REQUIRED_TOPIC}' topic`);
      resumeRepos.forEach(repo => {
        console.log(`  - ${repo.name}: ${repo.description || 'No description'}`);
      });

      return resumeRepos;
    } catch (error) {
      console.error('Error fetching repos:', error);
      return [];
    }
  }

  extractProjectInfo(repo) {
    const topics = repo.topics.filter(t => t !== CONFIG.REQUIRED_TOPIC) || [];
    
    // Determine project type based on topics
    let projectType = 'Project';
    for (const [type, keywords] of Object.entries(CONFIG.PROJECT_TYPES)) {
      if (keywords.some(keyword => 
        repo.name.toLowerCase().includes(keyword) ||
        repo.description?.toLowerCase().includes(keyword) ||
        topics.some(topic => topic.toLowerCase().includes(keyword))
      )) {
        projectType = type.charAt(0).toUpperCase() + type.slice(1) + ' Project';
        break;
      }
    }

    // Check for specific project type indicators
    if (repo.description?.toLowerCase().includes('game jam')) {
      projectType = 'Game Jam Project';
    } else if (repo.description?.toLowerCase().includes('published')) {
      projectType = 'Published ' + projectType;
    } else if (repo.description?.toLowerCase().includes('award')) {
      projectType = 'Award-Winning ' + projectType;
    }

    // Generate tags from language and topics
    const tags = [];
    
    // Add language as first tag
    if (repo.language) {
      const langLower = repo.language.toLowerCase();
      tags.push({
        name: repo.language,
        class: CONFIG.LANGUAGE_TAGS[langLower] || ''
      });
    }
    
    // Add topic-based tags (excluding 'resume' and language)
    topics.forEach(topic => {
      const formattedName = topic
        .replace(/-/g, ' ')
        .replace(/\b\w/g, l => l.toUpperCase());
      
      if (!tags.find(t => t.name.toLowerCase() === formattedName.toLowerCase())) {
        // Determine tag class based on topic
        let tagClass = '';
        if (topic.includes('unity')) tagClass = 'yellow';
        else if (topic.includes('pixel')) tagClass = 'yellow';
        else if (topic.includes('shader')) tagClass = 'yellow';
        
        tags.push({
          name: formattedName,
          class: tagClass
        });
      }
    });

    // Get the link URL (prefer homepage if available)
    const url = repo.homepage || `https://github.com/${this.username}/${repo.name}`;

    return {
      name: repo.name.replace(/[-_]/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
      description: repo.description || 'A project built with passion and attention to detail.',
      type: projectType,
      url: url,
      tags: tags.slice(0, 4), // Max 4 tags
      repoName: repo.name // Keep original name for file naming
    };
  }

  generateProjectCard(project) {
    const tagsHTML = project.tags
      .map(tag => `<span class="tag${tag.class ? ' ' + tag.class : ''}">${tag.name}</span>`)
      .join('\n                ');

    // Determine link type and label
    let linkLabel, linkUrl;
    if (project.url.includes('itch.io')) {
      linkLabel = 'Play →';
    } else if (project.url.includes('github.com')) {
      linkLabel = 'GitHub →';
    } else {
      linkLabel = 'Link →';
    }

    return `
        <article class="card">
            <div
                class="project-slider"
                data-alt="${project.name} screenshot"
                data-images="
                    assets/${project.repoName}.png,
                    assets/${project.repoName}1.png,
                    assets/${project.repoName}2.png
                "
            ></div>

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
    // Extract existing project names from the HTML
    const nameRegex = /<h3>(.*?)<\/h3>/g;
    let match;
    while ((match = nameRegex.exec(html)) !== null) {
      this.existingProjects.add(match[1].trim());
    }
    console.log(`Found ${this.existingProjects.size} existing projects`);
  }

  async updateProjectsFile() {
    const filePath = 'docs/partials/selected-projects.html';
    
    try {
      // Read existing file
      let html = await fs.readFile(filePath, 'utf8');
      
      // Parse existing projects
      this.parseExistingProjects(html);
      
      // Fetch resume-tagged repos
      const repos = await this.fetchResumeRepos();
      
      if (repos.length === 0) {
        console.log(`No repositories found with '${CONFIG.REQUIRED_TOPIC}' topic`);
        return;
      }
      
      // Extract project info for all resume repos
      const allResumeProjects = repos.map(repo => this.extractProjectInfo(repo));
      
      // Find new projects that don't exist yet
      const newProjects = allResumeProjects.filter(project => 
        !this.existingProjects.has(project.name)
      );

      if (newProjects.length === 0) {
        console.log('All resume projects already exist in the page');
        return;
      }

      console.log(`\n📦 Adding ${newProjects.length} new projects:`);
      newProjects.forEach(p => console.log(`  ✨ ${p.name}`));

      // Generate cards for new projects
      const newCards = newProjects
        .map(project => this.generateProjectCard(project))
        .join('\n');

      // Insert new cards before the "Additional" card or at the end of the grid
      const additionalCardMarker = '<div class="card" style="margin-top:15px;">';
      const gridEndMarker = '    </div>\n\n    <div class="card" style="margin-top:15px;">';
      
      if (html.includes(additionalCardMarker)) {
        // Insert before the additional card
        html = html.replace(additionalCardMarker, `${newCards}\n${additionalCardMarker}`);
      } else {
        // Insert before the closing section div
        const sectionEnd = '</section>';
        html = html.replace(sectionEnd, `${newCards}\n${sectionEnd}`);
      }

      // Write updated file
      await fs.writeFile(filePath, html, 'utf8');
      
      console.log('\n✅ Successfully updated selected projects');
      console.log(`   File: ${filePath}`);
      console.log(`   Added: ${newProjects.length} projects`);
      
    } catch (error) {
      console.error('❌ Error updating projects:', error);
      throw error;
    }
  }
}

// Execute
const updater = new ProjectUpdater();
updater.updateProjects().catch(error => {
  console.error('Script failed:', error);
  process.exit(1);
});