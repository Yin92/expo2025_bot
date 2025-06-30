// ==UserScript==
// @name         Expo 2025 Pavilion ／ Event Reservation Bot
// @namespace    http://tampermonkey.net/
// @version      1.7
// @description  Auto Reserve Expo 2025 Pavilion / Event every 5 seconds until success
// @author       Grok
// @match        https://ticket.expo2025.or.jp/*
// @grant        GM_xmlhttpRequest
// ==/UserScript==

(function() {
    'use strict';

    // Settings (at the top)
    const settings = {
        ticket_ids: [''],
        event_codes: [''], // Array of event codes
        entrance_date: getTodayDate(), // Dynamically set to today's date
        channel: '5',
        reservation_window_hours: 2, // Reserve within this many hours from now
        retry_delay_seconds: 5 // Retry delay in seconds
    };

    // Get today's date in YYYYMMDD format (in Asia/Tokyo timezone)
    function getTodayDate() {
        const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' });
        return today.replace(/-/g, '');
    }

    // Convert timeslot (e.g., "1330") to minutes since midnight for comparison
    function timeslotToMinutes(timeslot) {
        const hours = parseInt(timeslot.slice(0, 2), 10);
        const minutes = parseInt(timeslot.slice(2, 4), 10);
        return hours * 60 + minutes;
    }

    // Get current time in minutes since midnight (in Asia/Tokyo timezone)
    function getCurrentTimeMinutes() {
        const now = new Date();
        const timeString = now.toLocaleString('en-US', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hour12: false });
        const [hours, minutes] = timeString.split(':').map(Number);
        return hours * 60 + minutes;
    }

    // Refresh page every 15 minutes (900,000 milliseconds)
    const refreshInterval = 15 * 60 * 1000;
    setInterval(() => {
        console.log(`[${getTimestamp()}] Refreshing page to keep session alive`);
        location.reload();
    }, refreshInterval);

    function getTimestamp() {
        return new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' });
    }

    function fetchAvailableStartTimes(eventCode, eventName, callback) {
        const eventApiUrl = `https://ticket.expo2025.or.jp/api/d/events/${eventCode}?ticket_ids[]=${settings.ticket_ids[0]}&entrance_date=${settings.entrance_date}&channel=${settings.channel}`;
        GM_xmlhttpRequest({
            method: 'GET',
            url: eventApiUrl,
            onload: function(response) {
                try {
                    const data = JSON.parse(response.responseText);
                    const eventName = data.event_name || 'Unknown Event';
                    const schedules = data.event_schedules;
                    let availableTimeslot = null;
                    const outOfWindowTimeslots = [];
                    const currentTimeMinutes = getCurrentTimeMinutes();
                    const windowEndMinutes = currentTimeMinutes + (settings.reservation_window_hours * 60);

                    for (const startTime in schedules) {
                        const schedule = schedules[startTime];
                        const timeslotMinutes = timeslotToMinutes(startTime);
                        if (schedule.time_status !== 2 && schedule.unavailable_reason !== 1) {
                            if (
                                timeslotMinutes >= currentTimeMinutes &&
                                timeslotMinutes <= windowEndMinutes
                            ) {
                                availableTimeslot = startTime;
                                break; // Use the first available timeslot within the window
                            } else {
                                outOfWindowTimeslots.push(startTime);
                            }
                        }
                    }

                    if (outOfWindowTimeslots.length > 0) {
                        console.log(`[${getTimestamp()}] Available timeslots for ${eventName} (${eventCode}) outside ${settings.reservation_window_hours}-hour window:`, outOfWindowTimeslots);
                    }

                    if (availableTimeslot) {
                        console.log(`[${getTimestamp()}] Found available timeslot for ${eventName} (${eventCode}) within ${settings.reservation_window_hours} hours: ${availableTimeslot}`);
                        callback(eventCode, eventName, availableTimeslot);
                    } else {
                        console.log(`[${getTimestamp()}] No available timeslots found for ${eventName} (${eventCode}) within ${settings.reservation_window_hours} hours, retrying in ${settings.retry_delay_seconds} seconds...`);
                        setTimeout(() => fetchAvailableStartTimes(eventCode, eventName, callback), settings.retry_delay_seconds * 1000);
                    }
                } catch (e) {
                    console.error(`[${getTimestamp()}] Error parsing event API response for ${eventName} (${eventCode}):`, e);
                    setTimeout(() => fetchAvailableStartTimes(eventCode, eventName, callback), settings.retry_delay_seconds * 1000);
                }
            },
            onerror: function(error) {
                console.error(`[${getTimestamp()}] Failed to fetch event data for ${eventName} (${eventCode}):`, error);
                setTimeout(() => fetchAvailableStartTimes(eventCode, eventName, callback), settings.retry_delay_seconds * 1000);
            }
        });
    }

    function sendReservationRequest(eventCode, eventName, startTime) {
        const postData = {
            ticket_ids: settings.ticket_ids,
            entrance_date: settings.entrance_date,
            start_time: startTime,
            event_code: eventCode,
            registered_channel: settings.channel
        };
        GM_xmlhttpRequest({
            method: 'POST',
            url: 'https://ticket.expo2025.or.jp/api/d/user_event_reservations',
            headers: {
                'Content-Type': 'application/json'
            },
            data: JSON.stringify(postData),
            onload: function(response) {
                try {
                    const result = JSON.parse(response.responseText);
                    if (Object.keys(result).length === 0) {
                        console.log(`[${getTimestamp()}] Reservation successful for ${eventName} (${eventCode}) at timeslot ${startTime}`);
                        // Stop retrying for this event
                    } else if (result.error && result.error.name === 'schedule_out_of_stock') {
                        console.log(`[${getTimestamp()}] Out of stock for ${eventName} (${eventCode}) at timeslot ${startTime}, retrying in ${settings.retry_delay_seconds} seconds...`);
                        setTimeout(() => fetchAvailableStartTimes(eventCode, eventName, sendReservationRequest), settings.retry_delay_seconds * 1000);
                    } else {
                        console.log(`[${getTimestamp()}] Reservation failed for ${eventName} (${eventCode}) at timeslot ${startTime} with error:`, result);
                        setTimeout(() => fetchAvailableStartTimes(eventCode, eventName, sendReservationRequest), settings.retry_delay_seconds * 1000);
                    }
                } catch (e) {
                    console.error(`[${getTimestamp()}] Error parsing reservation response for ${eventName} (${eventCode}):`, e);
                    setTimeout(() => fetchAvailableStartTimes(eventCode, eventName, sendReservationRequest), settings.retry_delay_seconds * 1000);
                }
            },
            onerror: function(error) {
                console.error(`[${getTimestamp()}] Reservation request failed for ${eventName} (${eventCode}):`, error);
                setTimeout(() => fetchAvailableStartTimes(eventCode, eventName, sendReservationRequest), settings.retry_delay_seconds * 1000);
            }
        });
    }

    // Start the process for each event code
    console.log(`[${getTimestamp()}] Starting event reservation process for entrance_date: ${settings.entrance_date}`);
    settings.event_codes.forEach(eventCode => {
        // Fetch event name first to use in logs
        const eventApiUrl = `https://ticket.expo2025.or.jp/api/d/events/${eventCode}?ticket_ids[]=${settings.ticket_ids[0]}&entrance_date=${settings.entrance_date}&channel=${settings.channel}`;
        GM_xmlhttpRequest({
            method: 'GET',
            url: eventApiUrl,
            onload: function(response) {
                try {
                    const data = JSON.parse(response.responseText);
                    const eventName = data.event_name || 'Unknown Event';
                    console.log(`[${getTimestamp()}] Processing event: ${eventName} (${eventCode})`);
                    fetchAvailableStartTimes(eventCode, eventName, sendReservationRequest);
                } catch (e) {
                    console.error(`[${getTimestamp()}] Error fetching event name for ${eventCode}:`, e);
                    fetchAvailableStartTimes(eventCode, 'Unknown Event', sendReservationRequest);
                }
            },
            onerror: function(error) {
                console.error(`[${getTimestamp()}] Failed to fetch event data for ${eventCode}:`, error);
                fetchAvailableStartTimes(eventCode, 'Unknown Event', sendReservationRequest);
            }
        });
    });
})();
