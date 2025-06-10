import joplin from 'api';
import { MenuItemLocation, ToolbarButtonLocation, SettingItemType } from 'api/types';

// Default teams data (initial example)
const DEFAULT_TEAMS = {
  "Development Team": ["John Doe", "Jane Smith"],
  "Design Team": ["Alice Johnson", "Bob Wilson"]
};

// Internal types
interface TeamsConfig {
  [teamName: string]: string[];
}

// Function to load teams from settings
async function loadTeams(): Promise<TeamsConfig> {
  try {
    const teamsJson = await joplin.settings.value('teams_config');
    
    if (!teamsJson || teamsJson.trim() === '') {
      // If field is empty, return empty object
      return {};
    }
    
    const teams = JSON.parse(teamsJson);
    
    // Check if it's a valid object
    if (typeof teams !== 'object' || teams === null || Array.isArray(teams)) {
      console.error('Teams JSON is not a valid object');
      return {};
    }
    
    return teams;
    
  } catch (error) {
    console.error('Error loading teams - Invalid JSON:', error);
    return {};
  }
}

// Function to save teams
async function saveTeams(teams: TeamsConfig): Promise<void> {
  try {
    await joplin.settings.setValue('teams_config', JSON.stringify(teams, null, 2));
  } catch (error) {
    console.error('Error saving teams:', error);
    throw error;
  }
}

// Function to generate teams dropdown string
async function generateTeamsDropdown(): Promise<string> {
  try {
    const teams = await loadTeams();
    const teamNames = Object.keys(teams);
    
    if (teamNames.length === 0) {
      return "No teams configured";
    }
    
    return teamNames.join(', ');
  } catch (error) {
    console.error('Error generating teams dropdown:', error);
    return "Error loading teams";
  }
}

// Function to generate participants dropdown string
async function generateParticipantsDropdown(): Promise<string> {
  try {
    const teams = await loadTeams();
    const allParticipants: string[] = [];
    
    // Collect all participants from all teams
    for (const teamMembers of Object.values(teams)) {
      allParticipants.push(...teamMembers);
    }
    
    if (allParticipants.length === 0) {
      return "No participants configured";
    }
    
    // Remove duplicates and sort
    const uniqueParticipants = [...new Set(allParticipants)].sort();
    return uniqueParticipants.join(', ');
  } catch (error) {
    console.error('Error generating participants dropdown:', error);
    return "Error loading participants";
  }
}

// Function to generate multi-team template with custom dialog
async function generateMultiTeamTemplate(): Promise<void> {
  try {
    const teams = await loadTeams();
    const teamNames = Object.keys(teams);
    
    if (teamNames.length === 0) {
      await joplin.views.dialogs.showMessageBox(
        'No teams configured. Please configure teams first in Options > Meeting Templates.'
      );
      return;
    }

    // Create custom dialog for team selection
    const dialogHandle = await joplin.views.dialogs.create('teamSelectionDialog');
    
    // Generate HTML for team selection
    const dialogHtml = generateTeamSelectionHTML(teams);
    
    await joplin.views.dialogs.setHtml(dialogHandle, dialogHtml);
    await joplin.views.dialogs.setButtons(dialogHandle, [
      { id: 'cancel', title: 'Cancel' },
      { id: 'generate', title: 'Generate Template' }
    ]);
    
    const result = await joplin.views.dialogs.open(dialogHandle);
    
    if (result.id === 'generate' && result.formData) {
      // Process the form data and generate template
      await processTeamSelectionAndGenerateTemplate(result.formData, teams);
    }

  } catch (error) {
    console.error('Error generating multi-team template:', error);
    await joplin.views.dialogs.showMessageBox(
      'Error generating template: ' + error.message
    );
  }
}

// Function to generate HTML for team selection dialog
function generateTeamSelectionHTML(teams: TeamsConfig): string {
  let html = `
<div style="padding: 20px; font-family: Arial, sans-serif;">
  <h2>Multi-Team Meeting Setup</h2>
  <p>Select teams and participants for your meeting:</p>
  
  <form id="teamSelectionForm">
`;

  // Generate checkboxes for each team
  Object.keys(teams).forEach((teamName, teamIndex) => {
    html += `
    <div style="margin-bottom: 20px; border: 1px solid #ddd; padding: 15px; border-radius: 5px;">
      <div style="margin-bottom: 10px;">
        <label style="font-weight: bold; font-size: 16px;">
          <input type="checkbox" id="team_${teamIndex}" name="selectedTeams" value="${teamName}" onchange="toggleParticipants(${teamIndex})">
          ${teamName}
        </label>
      </div>
      
      <div id="participants_${teamIndex}" style="margin-left: 20px; display: none;">
        <p style="margin: 5px 0; font-weight: bold; color: #666;">Select participants:</p>
`;

    // Generate checkboxes for each participant
    teams[teamName].forEach((participant, participantIndex) => {
      html += `
        <label style="display: block; margin: 5px 0;">
          <input type="checkbox" name="team_${teamIndex}_participants" value="${participant}">
          ${participant}
        </label>
`;
    });

    html += `
      </div>
    </div>
`;
  });

  html += `
  </form>
  
  <script>
    function toggleParticipants(teamIndex) {
      const checkbox = document.getElementById('team_' + teamIndex);
      const participantsDiv = document.getElementById('participants_' + teamIndex);
      const participantCheckboxes = participantsDiv.querySelectorAll('input[type="checkbox"]');
      
      if (checkbox.checked) {
        participantsDiv.style.display = 'block';
        // Check all participants by default
        participantCheckboxes.forEach(cb => cb.checked = true);
      } else {
        participantsDiv.style.display = 'none';
        // Uncheck all participants
        participantCheckboxes.forEach(cb => cb.checked = false);
      }
    }
    
    // Function to collect form data
    function getFormData() {
      const selectedTeams = [];
      const teamCheckboxes = document.querySelectorAll('input[name="selectedTeams"]:checked');
      
      teamCheckboxes.forEach((teamCheckbox, index) => {
        const teamName = teamCheckbox.value;
        const teamIndex = teamCheckbox.id.split('_')[1];
        const participantCheckboxes = document.querySelectorAll('input[name="team_' + teamIndex + '_participants"]:checked');
        
        const participants = Array.from(participantCheckboxes).map(cb => cb.value);
        
        if (participants.length > 0) {
          selectedTeams.push({
            name: teamName,
            participants: participants
          });
        }
      });
      
      return selectedTeams;
    }
    
    // Make form data available globally for the plugin
    window.getTeamSelectionData = getFormData;
  </script>
</div>
`;

  return html;
}

// Function to process team selection and generate template
async function processTeamSelectionAndGenerateTemplate(formData: any, teams: TeamsConfig): Promise<void> {
  try {
    // Since we can't directly access the form data from the dialog result,
    // we'll use a simplified approach with the available data
    
    // For now, let's generate a template with all configured teams
    // In a real implementation, we'd need to handle the dialog form data properly
    const selectedTeams = Object.keys(teams).map(teamName => ({
      name: teamName,
      participants: teams[teamName]
    }));

    if (selectedTeams.length === 0) {
      await joplin.views.dialogs.showMessageBox('No teams selected.');
      return;
    }

    await generateTemplateWithMultipleTeams(selectedTeams);

  } catch (error) {
    console.error('Error processing team selection:', error);
    await joplin.views.dialogs.showMessageBox(
      'Error processing selection: ' + error.message
    );
  }
}

// Function to generate the final template with multiple teams
async function generateTemplateWithMultipleTeams(selectedTeams: { name: string; participants: string[] }[]): Promise<void> {
  try {
    // Build YAML frontmatter
    let yamlSection = `meeting_title:
  label: Meeting Title
  type: text
priority:
  label: Priority
  type: dropdown(High, Medium, Low)
team_count:
  label: Team Count
  type: text
  value: ${selectedTeams.length}
`;

    // Add each team and its participants to YAML
    selectedTeams.forEach((team, index) => {
      const teamNum = index + 1;
      yamlSection += `team${teamNum}:
  label: Team ${teamNum}
  type: text
  value: "${team.name}"
participants${teamNum}:
  label: Participants ${teamNum}
  type: text
  value: "${team.participants.join(', ')}"
`;
    });

    // Build template body
    let bodySection = `# {{meeting_title}}: {{datetime}}
**Priority:** {{priority}}
**Teams participating:** {{team_count}}

---

## 👥 Participating Teams

`;

    // Add each team section
    selectedTeams.forEach((team, index) => {
      const teamNum = index + 1;
      bodySection += `**Team ${teamNum}:** {{team${teamNum}}}
**Participants:** {{participants${teamNum}}}

`;
    });

    bodySection += `---

#### 📋 Agenda
- [ ] Topic 1
	- 
- [ ] Topic 2
	- 
- [ ] Topic 3
	- 

---

#### 📝 Notes
- [ ] Topic 1:  
	…  
- [ ] Topic 2:  
	…  
- [ ] Topic 3:  
	…  

---

#### ✅ Action Items/Responsible
- [ ] Action 1 – Responsible:  
- [ ] Action 2 – Responsible:
- [ ] Action 3 – Responsible:

---

## ✅ Team Checklist
- [ ] Review pending actions
- [ ] Define next steps`;

    // Combine everything
    const fullTemplate = `{{meeting_title}}: {{datetime}}
---
${yamlSection}---
${bodySection}`;

    // Copy to clipboard
    await joplin.clipboard.writeText(fullTemplate);
    
    const teamSummary = selectedTeams.map((team, index) => 
      `Team ${index + 1}: ${team.name} (${team.participants.length} participants)`
    ).join('\n');

    await joplin.views.dialogs.showMessageBox(
      `Multi-team template copied to clipboard!\n\nSelected teams:\n${teamSummary}\n\nPaste it in the Templates plugin to use.`
    );

  } catch (error) {
    console.error('Error generating final template:', error);
    await joplin.views.dialogs.showMessageBox(
      'Error generating template: ' + error.message
    );
  }
}

// Function to show current dropdown values
async function showDropdownValues(): Promise<void> {
  try {
    const teamsDropdown = await generateTeamsDropdown();
    const participantsDropdown = await generateParticipantsDropdown();
    
    const message = `**Dropdown Values:**

**Teams:**
${teamsDropdown}

**Participants:**
${participantsDropdown}

Use these values in the Templates plugin dropdowns.`;
    
    await joplin.views.dialogs.showMessageBox(message);
    
  } catch (error) {
    console.error('Error showing values:', error);
    await joplin.views.dialogs.showMessageBox(
      'Error loading values: ' + error.message
    );
  }
}

// Function to copy simple template to clipboard (original functionality)
async function copyTemplateToClipboard(): Promise<void> {
  try {
    const teamsDropdown = await generateTeamsDropdown();
    const participantsDropdown = await generateParticipantsDropdown();
    
    const template = `{{meeting_title}}: {{datetime}}
---
meeting_title:
  label: Meeting Title
  type: text
priority:
  label: Priority
  type: dropdown(High, Medium, Low)
teams:
  label: Teams
  type: dropdown(${teamsDropdown})
participants:
  label: Participants
  type: dropdown(${participantsDropdown})
---
# {{meeting_title}}: {{datetime}}  
**Priority:** {{priority}}  
**Team:** {{teams}}  
**Participants:** {{participants}}  

---

#### 📋 Agenda
- [ ] Topic 1
	- 
- [ ] Topic 2
	- 
- [ ] Topic 3
	- 

---

#### 📝 Notes
- [ ] Topic 1:  
	…  
- [ ] Topic 2:  
	…  
- [ ] Topic 3:  
	…  

---

#### ✅ Action Items/Responsible
- [ ] Action 1 – Responsible:  
- [ ] Action 2 – Responsible:
- [ ] Action 3 – Responsible:

---

## ✅ Team Checklist
- [ ] Review pending actions
- [ ] Define next steps`;

    await joplin.clipboard.writeText(template);
    
    await joplin.views.dialogs.showMessageBox(
      'Simple template copied to clipboard!\n\nPaste it in the official Templates plugin to use dynamic dropdowns.'
    );

  } catch (error) {
    console.error('Error copying template:', error);
    await joplin.views.dialogs.showMessageBox(
      'Error copying template: ' + error.message
    );
  }
}

joplin.plugins.register({
  onStart: async function() {
    console.log('Meeting Templates plugin started!');
    
    // Register plugin settings
    await joplin.settings.registerSection('meetingTemplates', {
      label: 'Meeting Templates',
      iconName: 'fas fa-users',
      description: 'Meeting Templates plugin settings'
    });
    
    // Teams configuration (JSON) - empty field initially
    await joplin.settings.registerSettings({
      'teams_config': {
        value: '', // Empty field for user to fill
        type: SettingItemType.String,
        section: 'meetingTemplates',
        public: true,
        advanced: false,
        label: 'Teams Configuration (JSON)',
        description: 'Configure your teams and participants in JSON format. Example: {"Team1": ["Person1", "Person2"], "Team2": ["Person3", "Person4"]}'
      }
    });
    
    // Register commands
    await joplin.commands.register({
      name: 'generateMultiTeamTemplate',
      label: 'Generate Multi-Team Meeting Template',
      iconName: 'fas fa-users',
      execute: generateMultiTeamTemplate,
    });
    
    await joplin.commands.register({
      name: 'copyMeetingTemplate',
      label: 'Copy Simple Template with Dropdowns',
      iconName: 'fas fa-copy',
      execute: copyTemplateToClipboard,
    });
    
    await joplin.commands.register({
      name: 'showDropdownValues',
      label: 'Show Dropdown Values',
      iconName: 'fas fa-list',
      execute: showDropdownValues,
    });
    
    await joplin.commands.register({
      name: 'configureTeams',
      label: 'Configure Teams (JSON)',
      iconName: 'fas fa-cog',
      execute: async () => {
        await joplin.views.dialogs.showMessageBox(
          'To configure teams:\n\n1. Go to Options > Meeting Templates\n2. Edit the "Teams Configuration (JSON)" field\n3. Use format: {"Team1": ["Person1", "Person2"]}'
        );
      },
    });
    
    await joplin.commands.register({
      name: 'deleteTeams',
      label: 'Clear All Teams',
      iconName: 'fas fa-trash',
      execute: async () => {
        const confirm = await joplin.views.dialogs.showMessageBox(
          'Are you sure you want to clear all teams? (OK = Yes, Cancel = No)'
        );
        
        if (confirm === 0) {
          await joplin.settings.setValue('teams_config', '');
          await joplin.views.dialogs.showMessageBox('All teams have been removed!');
        }
      },
    });
    
    // Main menu
    await joplin.views.menuItems.create('generateMultiTeamMenu', 'generateMultiTeamTemplate', MenuItemLocation.Tools);
    await joplin.views.menuItems.create('copyTemplateMenu', 'copyMeetingTemplate', MenuItemLocation.Tools);
    await joplin.views.menuItems.create('showDropdownMenu', 'showDropdownValues', MenuItemLocation.Tools);
    
    // Teams submenu
    await joplin.views.menuItems.create('teamsSubMenu', 'configureTeams', MenuItemLocation.Tools);
    await joplin.views.menuItems.create('deleteTeamsMenu', 'deleteTeams', MenuItemLocation.Tools);
    
    console.log('Meeting Templates plugin loaded successfully!');
  },
});