import {
  $TSAny, $TSContext, AmplifyError, amplifyFaultWithTroubleshootingLink,
} from 'amplify-cli-core';
import { printer } from 'amplify-prompts';

/* eslint-disable @typescript-eslint/explicit-function-return-type */
import inquirer from 'inquirer';
import ora from 'ora';
import { ChannelAction, ChannelConfigDeploymentType } from './channel-types';
import { buildPinpointChannelResponseSuccess } from './pinpoint-helper';

const channelName = 'Email';
const spinner = ora('');
const deploymentType = ChannelConfigDeploymentType.INLINE;

/**
 * Configure Email channel on analytics resource
 * @param context amplify cli context
 */
export const configure = async (context: $TSContext):Promise<void> => {
  const isChannelEnabled = context.exeInfo.serviceMeta.output[channelName]?.Enabled;

  if (isChannelEnabled) {
    printer.info(`The ${channelName} channel is currently enabled`);
    const answer = await inquirer.prompt({
      name: 'disableChannel',
      type: 'confirm',
      message: `Do you want to disable the ${channelName} channel`,
      default: false,
    });
    if (answer.disableChannel) {
      await disable(context);
    } else {
      const successMessage = `The ${channelName} channel has been successfully updated.`;
      await enable(context, successMessage);
    }
  } else {
    const answer = await inquirer.prompt({
      name: 'enableChannel',
      type: 'confirm',
      message: `Do you want to enable the ${channelName} channel`,
      default: true,
    });
    if (answer.enableChannel) {
      await enable(context, undefined);
    }
  }
};

/**
 * Enable Email channel on Analytics resource
 * @param context amplify cli context
 * @param successMessage message to be printed on successfully enabling channel
 */
export const enable = async (context:$TSContext, successMessage: string|undefined):Promise<$TSAny> => {
  let answers;
  if (context.exeInfo.pinpointInputParams?.[channelName]) {
    answers = validateInputParams(context.exeInfo.pinpointInputParams[channelName]);
  } else {
    let channelOutput:$TSAny = {};
    if (context.exeInfo.serviceMeta.output[channelName]) {
      channelOutput = context.exeInfo.serviceMeta.output[channelName];
    }
    const questions = [
      {
        name: 'FromAddress',
        type: 'input',
        message: "The 'From' Email address used to send emails",
        default: channelOutput.FromAddress,
      },
      {
        name: 'Identity',
        type: 'input',
        message: 'The ARN of an identity verified with SES',
        default: channelOutput.Identity,
      },
      {
        name: 'RoleArn',
        type: 'input',
        message: "The ARN of an IAM Role used to submit events to Mobile notifications' event ingestion service",
        default: channelOutput.RoleArn,
      },
    ];
    answers = await inquirer.prompt(questions);
  }

  const params = {
    ApplicationId: context.exeInfo.serviceMeta.output.Id,
    EmailChannelRequest: {
      ...answers,
      Enabled: true,
    },
  };

  spinner.start('Enabling Email Channel.');
  try {
    const data = await context.exeInfo.pinpointClient.updateEmailChannel(params).promise();
    spinner.succeed(successMessage ?? `The ${channelName} channel has been successfully enabled.`);
    context.exeInfo.serviceMeta.output[channelName] = data.EmailChannelResponse;
    return buildPinpointChannelResponseSuccess(ChannelAction.ENABLE, deploymentType, channelName, data.EmailChannelResponse);
  } catch (err) {
    if (err && err.code === 'NotFoundException') {
      spinner.succeed(`Project with ID '${params.ApplicationId}' was already deleted from the cloud.`);
      return buildPinpointChannelResponseSuccess(ChannelAction.ENABLE, deploymentType, channelName, {
        id: params.ApplicationId,
      });
    }

    spinner.stop();
    throw amplifyFaultWithTroubleshootingLink('NotificationsChannelEmailFault', {
      message: `Failed to enable the ${channelName} channel.`,
      details: err.message,
    });
  }
};

const validateInputParams = (channelInput: $TSAny) : $TSAny => {
  if (!channelInput.FromAddress || !channelInput.Identity || !channelInput.RoleArn) {
    throw new AmplifyError('UserInputError', {
      message: 'FromAddress, Identity or RoleArn is missing for the Email channel',
      resolution: 'Provide the required parameters for the Email channel',
    });
  }
  return channelInput;
};

/**
 * Disable Email notification channel on Analytics resource
 * @param context - amplify cli context
 * @returns Pinpoint API response
 */
export const disable = async (context:$TSContext) : Promise<$TSAny> => {
  const channelOutput = validateInputParams(context.exeInfo.serviceMeta.output[channelName]);
  const params = {
    ApplicationId: context.exeInfo.serviceMeta.output.Id,
    EmailChannelRequest: {
      Enabled: false,
      FromAddress: channelOutput.FromAddress,
      Identity: channelOutput.Identity,
    },
  };
  spinner.start('Disabling Email Channel.');
  try {
    const data = await context.exeInfo.pinpointClient.updateEmailChannel(params).promise();
    spinner.succeed(`The ${channelName} channel has been disabled.`);
    context.exeInfo.serviceMeta.output[channelName] = data.EmailChannelResponse;
    return buildPinpointChannelResponseSuccess(ChannelAction.DISABLE, deploymentType, channelName, data.EmailChannelResponse);
  } catch (err) {
    if (err && err.code === 'NotFoundException') {
      spinner.succeed(`Project with ID '${params.ApplicationId}' was already deleted from the cloud.`);
      return buildPinpointChannelResponseSuccess(ChannelAction.DISABLE, deploymentType, channelName, {
        id: params.ApplicationId,
      });
    }

    spinner.fail(`Failed to disable the ${channelName} channel.`);
    throw amplifyFaultWithTroubleshootingLink('NotificationsChannelEmailFault', {
      message: `Failed to disable the ${channelName} channel.`,
      details: err.message,
    });
  }
};

/**
 * Pull the Analytics resource and Email channel configuration
 * @param context amplify cli context
 * @param pinpointApp Pinpoint resource meta
 * @returns Pinpoint API response
 */
export const pull = async (context:$TSContext, pinpointApp:$TSAny):Promise<$TSAny> => {
  const params = {
    ApplicationId: pinpointApp.Id,
  };

  spinner.start(`Retrieving channel information for ${channelName}.`);
  try {
    const data = await context.exeInfo.pinpointClient.getEmailChannel(params).promise();
    spinner.succeed(`Channel information retrieved for ${channelName}`);
    // eslint-disable-next-line no-param-reassign
    pinpointApp[channelName] = data.EmailChannelResponse;
    return buildPinpointChannelResponseSuccess(ChannelAction.PULL, deploymentType, channelName, data.EmailChannelResponse);
  } catch (err) {
    spinner.stop();
    if (err.code !== 'NotFoundException') {
      throw amplifyFaultWithTroubleshootingLink('NotificationsChannelEmailFault', {
        message: `Failed to pull the ${channelName} channel.`,
        details: err.message,
      });
    }

    return undefined;
  }
};
