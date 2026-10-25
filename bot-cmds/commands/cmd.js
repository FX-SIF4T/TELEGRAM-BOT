import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import https from 'https';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COMMAND_NAME_PATTERN = /^[a-z][a-z0-9_-]{0,39}$/;
const MAX_COMMAND_BYTES = 512 * 1024;
const PROTECTED_COMMANDS = new Set([
  'admin', 'cmd', 'dev', 'devonly', 'eval', 'help', 'prefix', 'shell', 'start', 'up'
]);

export const meta = {
  name: "cmd",
  aliases: [],
  prefix: "both",
  version: "1.0.0",
  author: "SIFAT",
  description: "Manage commands: install, delete, load, unload, loadall",
  guide: [
    "install <url> <command file name> - Download and install a command file from a url",
    "delete <commandName>              - Deletes a command",
    "load <commandName>                - Loads a command",
    "unload <commandName>              - Unloads a command",
    "loadall                           - Loads all commands and events"
  ],
  cooldown: 5,
  type: "dev",
  category: "dev"
};

function unloadCommand(commandName) {
  if (global.esha?.commands instanceof Map) {
    global.esha.commands.delete(commandName);
  }
}

function isCommandName(value) {
  return typeof value === 'string' && COMMAND_NAME_PATTERN.test(value);
}

function validateCommandModule(commandModule, commandName) {
  const module = commandModule.default ?? commandModule;
  if (
    !module?.meta ||
    typeof module.meta !== 'object' ||
    typeof module.meta.name !== 'string' ||
    typeof module.onStart !== 'function'
  ) {
    throw new Error('Invalid command module: expected meta and onStart.');
  }
  if (module.meta.name !== commandName) {
    throw new Error(`Command name mismatch: expected "${commandName}", got "${module.meta.name}".`);
  }
  if (
    module.meta.aliases !== undefined &&
    (!Array.isArray(module.meta.aliases) ||
      module.meta.aliases.some((alias) => typeof alias !== 'string' || !COMMAND_NAME_PATTERN.test(alias)))
  ) {
    throw new Error('Command aliases must be valid lowercase command names.');
  }
  const candidateNames = [
    commandName,
    ...(Array.isArray(module.meta.aliases) ? module.meta.aliases : [])
  ];
  if (new Set(candidateNames).size !== candidateNames.length) {
    throw new Error('Command name and aliases must be unique.');
  }
  const existing = global.esha?.commands;
  if (existing instanceof Map && [...existing.values()].some((entry) => {
    if (entry.meta?.name === commandName) return false;
    const names = [entry.meta?.name, ...(Array.isArray(entry.meta?.aliases) ? entry.meta.aliases : [])];
    return names.some((name) =>
      typeof name === 'string' &&
      candidateNames.some((candidate) => candidate.toLowerCase() === name.toLowerCase())
    );
  })) {
    throw new Error(`A command or alias named "${commandName}" is already loaded.`);
  }
  return module;
}

function downloadFromUrl(url) {
  return new Promise((resolve, reject) => {
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch {
      reject(new Error('Invalid URL.'));
      return;
    }
    if (parsedUrl.protocol !== 'https:' || parsedUrl.username || parsedUrl.password) {
      reject(new Error('Only HTTPS URLs without embedded credentials are allowed.'));
      return;
    }

    const request = https.get(parsedUrl, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`Failed to download: Status code ${res.statusCode}`));
        return;
      }
      const chunks = [];
      let totalBytes = 0;
      res.on('data', (chunk) => {
        totalBytes += chunk.length;
        if (totalBytes > MAX_COMMAND_BYTES) {
          request.destroy(new Error('Command file exceeds the 512 KB limit.'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    });
    request.setTimeout(15000, () => request.destroy(new Error('Download timed out after 15 seconds.')));
    request.on('error', reject);
  });
}

export async function onStart({ response, args, usages }) {
  if (!args[0]) return await usages();

  const action = args[0].toLowerCase();
  const commandsDir = __dirname;

  switch (action) {
    case 'install': {
      if (args.length !== 3) {
        return await response.reply("Provide exactly: install <url> <command file name>");
      }

      const commandName = args[2];
      if (!isCommandName(commandName)) {
        return response.reply('Use a lowercase command name with letters, numbers, "_" or "-".');
      }
      if (global.esha?.commands?.has(commandName)) {
        return response.reply(`Command already loaded: ${commandName}.`);
      }

      const destination = path.join(commandsDir, `${commandName}.js`);
      const temporaryPath = `${destination}.${process.pid}.tmp.mjs`;
      let content;
      try {
        content = await downloadFromUrl(args[1]);
      } catch (error) {
        return response.reply(`Error downloading command: ${error.message}`);
      }

      if (await fs.pathExists(destination)) {
        return response.reply(`Command already exists: ${commandName}.js`);
      }

      try {
        await fs.writeFile(temporaryPath, content, { encoding: 'utf8', flag: 'wx' });
        const moduleUrl = `${pathToFileURL(temporaryPath).href}?t=${Date.now()}`;
        const commandModule = validateCommandModule(await import(moduleUrl), commandName);
        await fs.rename(temporaryPath, destination);
        unloadCommand(commandName);
        global.esha.commands.set(commandName, commandModule);
        return response.reply(`Command installed successfully: ${commandName}.js`);
      } catch (error) {
        await fs.remove(temporaryPath).catch(() => {});
        console.error("Error installing command:", error);
        let errorMessage = `Error installing command: ${error.message}`;
        if (error instanceof SyntaxError) {
          errorMessage += ". Make sure the code is valid JavaScript (not TypeScript; remove type annotations if present).";
        }
        return await response.reply(errorMessage);
      }
    }

    case 'delete': {
      if (!args[1]) {
        return await response.reply("Please provide the command name to delete.");
      }

      const commandName = args[1];
      if (!isCommandName(commandName)) {
        return response.reply('Invalid command name.');
      }
      if (PROTECTED_COMMANDS.has(commandName)) {
        return response.reply(`The core command "${commandName}" cannot be deleted.`);
      }
      try {
        const commandFile = path.join(commandsDir, `${commandName}.js`);
        if (!await fs.pathExists(commandFile)) {
          return await response.reply(`Command file not found: ${commandName}.js`);
        }

        unloadCommand(commandName);
        await fs.remove(commandFile);
        return await response.reply(`Command deleted successfully: ${commandName}.js`);
      } catch (error) {
        console.error("Error deleting command:", error);
        return await response.reply(`Error deleting command: ${error.message}`);
      }
    }

    case 'load': {
      if (!args[1]) {
        return await response.reply("Please provide the command name to load.");
      }

      const commandName = args[1];
      if (!isCommandName(commandName)) {
        return response.reply('Invalid command name.');
      }
      try {
        const commandFile = path.join(commandsDir, `${commandName}.js`);
        if (!await fs.pathExists(commandFile)) {
          return await response.reply(`Command file not found: ${commandName}.js`);
        }

        const moduleUrl = `${pathToFileURL(commandFile).href}?t=${Date.now()}`;
        const commandModule = validateCommandModule(await import(moduleUrl), commandName);
        unloadCommand(commandName);
        global.esha.commands.set(commandModule.meta.name, commandModule);
        return await response.reply(`Command loaded successfully: ${commandModule.meta.name}`);
      } catch (error) {
        console.error("Error loading command:", error);
        return await response.reply(`Error loading command: ${error.message}`);
      }
    }

    case 'unload': {
      if (!args[1]) {
        return await response.reply("Please provide the command name to unload.");
      }

      const commandName = args[1];
      if (!isCommandName(commandName)) {
        return response.reply('Invalid command name.');
      }
      if (PROTECTED_COMMANDS.has(commandName)) {
        return response.reply(`The core command "${commandName}" cannot be unloaded.`);
      }
      try {
        unloadCommand(commandName);
        return await response.reply(`Command unloaded successfully: ${commandName}`);
      } catch (error) {
        console.error("Error unloading command:", error);
        return await response.reply(`Error unloading command: ${error.message}`);
      }
    }

    case 'loadall': {
      try {
        if (typeof global.scripts !== 'function') {
          return await response.reply("Error: scripts is not properly defined.");
        }

        const errors = await global.scripts();
        if (errors && Object.keys(errors).length > 0) {
          return await response.reply(`Loaded all commands with some errors: ${JSON.stringify(errors)}`);
        }
        return await response.reply("All commands loaded successfully.");
      } catch (error) {
        console.error("Error loading all commands:", error);
        return await response.reply(`Error loading all commands: ${error.message}`);
      }
    }

    default: {
      return await response.reply("Unknown action. Valid actions: install, delete, load, unload, loadall.");
    }
  }
}