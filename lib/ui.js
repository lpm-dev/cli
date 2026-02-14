import boxen from 'boxen';
import chalk from 'chalk';
import ora from 'ora';

export const printHeader = () => {
  console.log(chalk.dim('Licensed Package Manager CLI\n'));
};

export const printUpdateNotice = _pkg => {
  // This will be handled by update-notifier in the main entry point,
  // but we can have a custom one if needed.
};

export const createSpinner = text => {
  return ora({
    text,
    color: 'cyan',
    spinner: 'dots',
  });
};

export const log = {
  success: msg => console.log(chalk.green(`✔ ${msg}`)),
  error: msg => console.log(chalk.red(`✖ ${msg}`)),
  info: msg => console.log(chalk.blue(`ℹ ${msg}`)),
  warn: msg => console.log(chalk.yellow(`⚠ ${msg}`)),
  dim: msg => console.log(chalk.dim(msg)),
  box: (msg, title) => {
    console.log(
      boxen(msg, {
        padding: 1,
        margin: 1,
        borderStyle: 'round',
        borderColor: 'cyan',
        title: title,
        titleAlignment: 'center',
      }),
    );
  },
};
