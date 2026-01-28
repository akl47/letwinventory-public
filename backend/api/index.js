var router = require('express').Router();
var fs = require('fs');

fs.readdirSync(__dirname)
    .filter(group => {
        return (group.indexOf('.') === -1);
    })
    .forEach(group => {
        const groupPath = __dirname + '/' + group;
        const groupContents = fs.readdirSync(groupPath);

        // Check if this group has a direct routes.js file
        if (groupContents.includes('routes.js')) {
            router.use('/' + group, require('./' + group + '/routes'));
        }

        // Also check for nested folders with routes
        groupContents
            .filter(folder => {
                return (folder.indexOf('.') === -1);
            })
            .forEach(folder => {
                const folderPath = groupPath + '/' + folder;
                if (fs.statSync(folderPath).isDirectory() && fs.existsSync(folderPath + '/routes.js')) {
                    router.use('/' + group + '/' + folder, require('./' + group + '/' + folder + '/routes'));
                }
            });
    });

module.exports = router;